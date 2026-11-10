import os
from pathlib import Path
import socket
import subprocess
import time

import pymysql
import pytest
import requests

from conftest import Api
from mysql_proxy import mysql_proxy
from test_api import await_task, expect, expect_error, submit, upload


@pytest.fixture
def backend_process(tmp_path):
    if not (os.environ.get("BACKEND_JAR") and os.environ.get("TEST_RESTART_DB_NAME")):
        pytest.skip("需要打包的 Java 服务及单独的重启验收数据库")
    jar = Path(os.environ["BACKEND_JAR"]).resolve()
    database = os.environ["TEST_RESTART_DB_NAME"]
    db_host = os.environ.get("TEST_DB_HOST", "127.0.0.1")
    db_port = int(os.environ.get("TEST_DB_PORT", "3306"))
    db_user = os.environ.get("TEST_DB_USER", "workbench")
    db_password = os.environ.get("TEST_DB_PASSWORD", "workbench-test")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

    environment = dict(
        os.environ,
        SERVER_ADDRESS="127.0.0.1",
        SERVER_PORT=str(port),
        DB_USER=db_user,
        DB_PASSWORD=db_password,
        SPRING_DATASOURCE_HIKARI_CONNECTION_TIMEOUT="800",
        ASSETS_DIRECTORY=str(tmp_path / "assets"),
    )
    logs = tmp_path / "backend.log"
    client = Api(f"http://127.0.0.1:{port}")
    processes = []

    def start(simulation_enabled, database_port=db_port):
        with logs.open("wb") as log:
            process = subprocess.Popen(
                ["java", "-jar", str(jar)], cwd=tmp_path,
                env=dict(environment, SIMULATION_ENABLED=simulation_enabled,
                         DB_URL=f"jdbc:mysql://{db_host}:{database_port}/{database}"),
                stdout=log, stderr=subprocess.STDOUT,
            )
        processes.append(process)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline and process.poll() is None:
            try:
                if client.request("GET", "/api/health").status_code == 200:
                    return process
            except requests.exceptions.RequestException:
                pass
            time.sleep(0.1)
        pytest.fail("Java service failed to start:\n" + logs.read_text(errors="replace"))

    def inspect_task(task_id):
        with pymysql.connect(host=db_host, port=db_port, user=db_user, password=db_password,
                             database=database, cursorclass=pymysql.cursors.DictCursor) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT status, stage FROM tasks WHERE id = %s", (int(task_id),))
                return cursor.fetchone()

    try:
        yield client, start, inspect_task, db_host, db_port
    finally:
        client.session.close()
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


def test_restart_interrupts_processing_and_preserves_queue_and_assets(backend_process):
    client, start, _, _, _ = backend_process
    first_process = start("true")
    expect(client.request("POST", "/api/session", json={"userId": "demo-a"}), 200)
    asset = expect(upload(client, "postcard"), 201)["id"]
    finished = expect(submit(client, "postcard", [asset]), 202)
    await_task(client, finished["id"], "SUCCEEDED", "FINALIZE")
    interrupted = expect(submit(client, "postcard", [asset], delay=5000), 202)
    queued = expect(submit(client, "postcard", [asset]), 202)
    await_task(client, interrupted["id"], "PROCESSING", "CHECK_ASSETS")
    assert expect(client.request("GET", f"/api/tasks/{queued['id']}"), 200)["status"] == "PENDING"

    first_process.kill()
    first_process.wait(timeout=10)
    start("false")
    expect_error(client.request("GET", "/api/tasks"), 401)
    expect(client.request("POST", "/api/session", json={"userId": "demo-a"}), 200)
    failed = await_task(client, interrupted["id"], "FAILED", "CHECK_ASSETS")
    assert failed["failure"]["code"] == "PROCESS_INTERRUPTED"
    assert failed["resultUrl"] is None
    await_task(client, queued["id"], "SUCCEEDED", "FINALIZE")
    await_task(client, finished["id"], "SUCCEEDED", "FINALIZE")

    before = expect(client.request("GET", "/api/tasks"), 200)["tasks"]
    expect_error(submit(client, "postcard", [asset], delay=1), 400)
    assert expect(client.request("GET", "/api/tasks"), 200)["tasks"] == before


def test_mysql_disconnect_pauses_queue_and_recovery_continues_current_task(backend_process):
    client, start, inspect_task, db_host, db_port = backend_process
    with mysql_proxy(db_host, db_port) as proxy:
        start("true", proxy.server_address[1])
        expect(client.request("POST", "/api/session", json={"userId": "demo-a"}), 200)
        asset = expect(upload(client, "postcard"), 201)["id"]
        first = expect(submit(client, "postcard", [asset], delay=1200), 202)["id"]
        queued = expect(submit(client, "postcard", [asset]), 202)["id"]
        await_task(client, first, "PROCESSING", "GENERATE")

        proxy.set_enabled(False)
        expect_error(client.request("GET", f"/api/tasks/{first}"), 503)
        time.sleep(1.4)
        assert inspect_task(first) == {"status": "PROCESSING", "stage": "GENERATE"}
        assert inspect_task(queued) == {"status": "PENDING", "stage": None}

        proxy.set_enabled(True)
        deadline = time.monotonic() + 8
        while client.request("GET", "/api/health").status_code != 200:
            assert time.monotonic() < deadline, "MySQL health did not recover"
            time.sleep(0.1)
        await_task(client, first, "SUCCEEDED", "FINALIZE")
        await_task(client, queued, "SUCCEEDED", "FINALIZE")
