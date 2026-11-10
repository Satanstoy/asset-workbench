import datetime
import os
import time
import uuid
from pathlib import Path

import pymysql
import pytest

from conftest import png


def expect(response, status):
    assert response.status_code == status, response.text
    return response.json()


def expect_error(response, status):
    error = expect(response, status)["error"]
    assert error["code"]
    assert error["message"]
    return error


def upload(client, template, data=None, filename="picture.png", mime="image/png"):
    return client.request(
        "POST", "/api/assets", data={"templateId": template},
        files={"file": (filename, png() if data is None else data, mime)},
    )


def submit(client, template, assets, delay=0, failure=None):
    simulation = {"stageDelayMs": delay}
    if failure:
        simulation["failAtStage"] = failure
    return client.request("POST", "/api/tasks", json={
        "templateId": template, "assetIds": assets, "simulation": simulation,
    })


def read_task(client, task_id):
    return expect(client.request("GET", f"/api/tasks/{task_id}"), 200)


def await_task(client, task_id, status, stage):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        task = read_task(client, task_id)
        if task["status"] == status and task["stage"] == stage:
            return task
        if task["status"] in ("SUCCEEDED", "FAILED"):
            pytest.fail(f"Unexpected terminal state: {task}")
        time.sleep(0.04)
    pytest.fail(f"Timed out waiting for {status}/{stage}; last response: {task}")


@pytest.fixture
def templates(client_factory):
    body = expect(client_factory().request("GET", "/api/templates"), 200)
    return body["templates"]


@pytest.fixture
def single(templates):
    return next(t["id"] for t in templates if t["requiredImageCount"] == 1)


@pytest.fixture
def double(templates):
    return next(t["id"] for t in templates if t["requiredImageCount"] == 2)


def test_health_templates_filter_detail_and_local_images(client_factory):
    client = client_factory()
    assert expect(client.request("GET", "/api/health"), 200)["status"] == "UP"
    body = expect(client.request("GET", "/api/templates"), 200)
    assert len(body["categories"]) >= 2
    assert {1, 2}.issubset({item["requiredImageCount"] for item in body["templates"]})
    for category in body["categories"]:
        filtered = expect(client.request("GET", "/api/templates", params={"category": category}), 200)
        assert filtered["categories"] == body["categories"]
        assert filtered["templates"] == [t for t in body["templates"] if t["category"] == category]
    empty = expect(client.request("GET", "/api/templates", params={"category": "不存在的分类"}), 200)
    assert empty["templates"] == []
    for template in body["templates"]:
        assert expect(client.request("GET", f"/api/templates/{template['id']}"), 200) == template
        assert template["description"]
        assert set(template["acceptedMimeTypes"]) == {"image/jpeg", "image/png"}
        assert template["maxFileSizeBytes"] == 5 * 1024 * 1024
        assert template["maxImagePixels"] == 25_000_000
        cover = client.request("GET", template["coverUrl"])
        assert cover.status_code == 200
        assert cover.headers["Content-Type"].startswith("image/")
        assert cover.content
    expect_error(client.request("GET", "/api/templates/does-not-exist"), 404)
    expect_error(client.request("GET", "/api/demo-images/not-bundled.png"), 404)


def test_session_switch_invalidates_old_cookie(client_factory):
    client = client_factory()
    current = client.request("GET", "/api/session")
    assert expect(current, 200) == {"user": None}
    assert "no-store" in current.headers["Cache-Control"]
    for invalid in ({}, {"userId": "demo-z"}, {"userId": 123}):
        expect_error(client.request("POST", "/api/session", json=invalid), 400)
    first = client.request("POST", "/api/session", json={"userId": "demo-a"})
    assert expect(first, 200)["user"]["id"] == "demo-a"
    assert "HttpOnly" in first.headers["Set-Cookie"]
    old = first.headers["Set-Cookie"].split(";", 1)[0]
    assert expect(client.request("POST", "/api/session", json={"userId": "demo-b"}), 200)["user"]["id"] == "demo-b"
    stale = client_factory()
    assert expect(stale.request("GET", "/api/session", headers={"Cookie": old}), 200) == {"user": None}
    expect_error(stale.request("GET", "/api/tasks", headers={"Cookie": old}), 401)


def test_asset_validation_and_metadata(client_factory, single, db):
    expect_error(upload(client_factory(), single), 401)
    owner = client_factory("demo-a")
    before = {row["id"] for row in db("SELECT id FROM assets")}
    expect_error(upload(owner, "does-not-exist"), 404)
    expect_error(owner.request("POST", "/api/assets", files={"templateId": (None, single)}), 400)
    expect_error(owner.request("POST", "/api/assets", data={"templateId": single}), 415)
    expect_error(upload(owner, single, b"not an image"), 400)
    expect_error(upload(owner, single, png(), "image.jpg", "image/jpeg"), 400)
    expect_error(upload(owner, single, b"x" * (5 * 1024 * 1024 + 1)), 413)
    expect_error(upload(owner, single, png(5001, 5000)), 400)
    assert {row["id"] for row in db("SELECT id FROM assets")} == before

    image = png()
    data = expect(upload(owner, single, image), 201)
    assert data == {"id": data["id"], "mimeType": "image/png", "sizeBytes": len(image)}
    row, = db("SELECT owner_id, mime_type, size_bytes, width, height FROM assets WHERE id = %s", data["id"])
    assert row == {
        "owner_id": "demo-a", "mime_type": "image/png", "size_bytes": len(image), "width": 2, "height": 2,
    }
    jpeg = Path(__file__).with_name("fixtures").joinpath("photo.jpg").read_bytes()
    jpeg_asset = expect(upload(owner, single, jpeg, "photo.jpg", "image/jpeg"), 201)
    assert jpeg_asset["mimeType"] == "image/jpeg" and jpeg_asset["sizeBytes"] == len(jpeg)


def test_submission_queue_history_and_persisted_outcomes(client_factory, single, double, db):
    owner = client_factory("demo-a")
    other = client_factory("demo-b")
    image_id = expect(upload(owner, single), 201)["id"]
    first_response = submit(owner, double, [image_id, image_id], delay=800, failure="GENERATE")
    first = expect(first_response, 202)
    assert "no-store" in first_response.headers["Cache-Control"]
    assert first["status"] == "PENDING" and first["stage"] is None
    assert first["resultUrl"] is None and first["failure"] is None
    datetime.datetime.fromisoformat(first["createdAt"].replace("Z", "+00:00"))
    second = expect(submit(owner, single, [image_id], delay=800), 202)
    assert first["id"] != second["id"]

    await_task(owner, first["id"], "PROCESSING", "CHECK_ASSETS")
    await_task(owner, first["id"], "PROCESSING", "GENERATE")
    active = expect(owner.request("GET", "/api/tasks", params={
        "templateId": single, "activeOnly": "true",
    }), 200)["tasks"]
    queued = next(item for item in active if item["id"] == second["id"])
    assert queued["status"] == "PENDING"
    failed = await_task(owner, first["id"], "FAILED", "GENERATE")
    assert failed["failure"]["code"] == "SIMULATED_FAILURE"
    assert failed["resultUrl"] is None
    for stage in ("CHECK_ASSETS", "GENERATE", "FINALIZE"):
        await_task(owner, second["id"], "PROCESSING", stage)
    success = await_task(owner, second["id"], "SUCCEEDED", "FINALIZE")
    assert success["failure"] is None
    result = owner.request("GET", success["resultUrl"])
    assert result.status_code == 200 and result.headers["Content-Type"].startswith("image/")
    assert read_task(owner, second["id"]) == success

    history = expect(owner.request("GET", "/api/tasks"), 200)["tasks"]
    assert [item["id"] for item in history if item["id"] in {first["id"], second["id"]}] == [
        second["id"], first["id"],
    ]
    active_ids = {
        item["id"] for item in expect(owner.request("GET", "/api/tasks", params={"activeOnly": "true"}), 200)["tasks"]
    }
    assert active_ids.isdisjoint({first["id"], second["id"]})
    expect_error(other.request("GET", f"/api/tasks/{first['id']}"), 404)
    assert all(item["id"] != first["id"] for item in expect(other.request("GET", "/api/tasks"), 200)["tasks"])
    assert db("SELECT slot, asset_id FROM task_inputs WHERE task_id = %s ORDER BY slot", int(first["id"])) == [
        {"slot": 0, "asset_id": image_id}, {"slot": 1, "asset_id": image_id},
    ]
    row, = db("SELECT status, stage, result_url FROM tasks WHERE id = %s", int(second["id"]))
    assert row == {"status": "SUCCEEDED", "stage": "FINALIZE", "result_url": success["resultUrl"]}


def test_invalid_submissions_and_filters_do_not_mutate_task_tables(client_factory, single, db):
    owner = client_factory("demo-a")
    other = client_factory("demo-b")
    guest = client_factory()
    image_id = expect(upload(owner, single), 201)["id"]
    def counts():
        return db("SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM task_inputs) AS inputs")

    before = counts()
    expect_error(guest.request("GET", "/api/tasks"), 401)
    expect_error(submit(guest, single, [image_id]), 401)
    expect_error(submit(other, single, [image_id]), 400)
    expect_error(submit(owner, single, []), 400)
    expect_error(submit(owner, single, ["unknown-asset"]), 400)
    expect_error(submit(owner, 123, [image_id]), 400)
    expect_error(submit(owner, "unknown-template", [image_id]), 404)
    for invalid in (-1, 10001, 1.5, "10", True):
        expect_error(submit(owner, single, [image_id], delay=invalid), 400)
    expect_error(submit(owner, single, [image_id], failure="UNKNOWN_STAGE"), 400)
    expect_error(owner.request("GET", "/api/tasks/not-a-task"), 404)
    expect_error(owner.request("GET", "/api/tasks", params={"activeOnly": "maybe"}), 400)
    assert counts() == before


def test_database_rejects_a_successful_task_without_a_result(single, db):
    owner_id = "test-invariant"
    try:
        with pytest.raises(pymysql.DatabaseError) as failure:
            db("""
                INSERT INTO tasks (owner_id, template_id, status, stage, stage_delay_ms)
                VALUES (%s, %s, 'SUCCEEDED', 'FINALIZE', 0)
                """, owner_id, single)
        assert failure.value.args[0] == 3819
    finally:
        db("DELETE FROM tasks WHERE owner_id = %s", owner_id)


def test_task_transaction_rolls_back_when_writing_a_later_input_fails(client_factory, double, db):
    owner = client_factory("demo-a")
    first = expect(upload(owner, double), 201)["id"]
    second = expect(upload(owner, double), 201)["id"]
    before = db("SELECT COUNT(*) AS total FROM tasks")
    trigger = "test_inputs_" + uuid.uuid4().hex
    db(f"""
        CREATE TRIGGER {trigger} BEFORE INSERT ON task_inputs FOR EACH ROW
        BEGIN
          IF NEW.asset_id = %s THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test rollback'; END IF;
        END
        """, second)
    try:
        expect_error(submit(owner, double, [first, second]), 500)
        assert db("SELECT COUNT(*) AS total FROM tasks") == before
        assert db("SELECT task_id FROM task_inputs WHERE asset_id IN (%s, %s)", first, second) == ()
    finally:
        db(f"DROP TRIGGER {trigger}")


def test_upload_rolls_back_the_file_when_its_metadata_insert_fails(client_factory, single, db):
    directory = Path(os.environ["TEST_ASSETS_DIRECTORY"])
    directory.mkdir(parents=True, exist_ok=True)
    before_files = set(directory.iterdir())
    before_rows = db("SELECT COUNT(*) AS total FROM assets")
    owner = client_factory("demo-a")
    trigger = "test_assets_" + uuid.uuid4().hex
    db(f"""
        CREATE TRIGGER {trigger} BEFORE INSERT ON assets FOR EACH ROW
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test asset rollback'
        """)
    try:
        expect_error(upload(owner, single), 500)
        assert set(directory.iterdir()) == before_files
        assert db("SELECT COUNT(*) AS total FROM assets") == before_rows
    finally:
        db(f"DROP TRIGGER {trigger}")


@pytest.mark.parametrize("stage", ["CHECK_ASSETS", "GENERATE", "FINALIZE"])
def test_each_simulated_failure_is_persisted(client_factory, single, db, stage):
    owner = client_factory("demo-a")
    image_id = expect(upload(owner, single), 201)["id"]
    task = expect(submit(owner, single, [image_id], failure=stage), 202)
    failed = await_task(owner, task["id"], "FAILED", stage)
    assert failed["failure"]["code"] == "SIMULATED_FAILURE"
    row, = db("SELECT status, stage, failure_code, result_url FROM tasks WHERE id = %s", int(task["id"]))
    assert row == {"status": "FAILED", "stage": stage, "failure_code": "SIMULATED_FAILURE", "result_url": None}


def test_missing_result_image_fails_only_its_task(client_factory, single, db):
    owner = client_factory("demo-a")
    image = expect(upload(owner, single), 201)["id"]
    template = "missing-" + uuid.uuid4().hex
    db("""
        INSERT INTO templates (id, title, category, cover_image, description, required_image_count, result_image)
        VALUES (%s, '缺少预置图', '测试', 'postcard-cover.png', '验证结果整理失败', 1, 'missing-result.png')
        """, template)
    try:
        missing = expect(submit(owner, template, [image]), 202)["id"]
        next_task = expect(submit(owner, single, [image]), 202)["id"]
        failed = await_task(owner, missing, "FAILED", "FINALIZE")
        assert failed["failure"]["code"] == "RESULT_UNAVAILABLE"
        assert failed["resultUrl"] is None
        await_task(owner, next_task, "SUCCEEDED", "FINALIZE")
    finally:
        db("DELETE task_inputs FROM task_inputs JOIN tasks ON task_inputs.task_id = tasks.id WHERE template_id = %s", template)
        db("DELETE FROM tasks WHERE template_id = %s", template)
        db("DELETE FROM templates WHERE id = %s", template)
