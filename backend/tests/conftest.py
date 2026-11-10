import os
import struct
import zlib

import pymysql
import pytest
import requests


def png(width=2, height=2):
    """Build a real grayscale PNG without adding an image-library dependency."""
    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload))
        )

    compressor = zlib.compressobj()
    scanline = bytes(width + 1)
    pixels = b"".join(compressor.compress(scanline) for _ in range(height))
    pixels += compressor.flush()
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
        + chunk(b"IDAT", pixels)
        + chunk(b"IEND", b"")
    )


class Api:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.trust_env = False

    def request(self, method, path, **kwargs):
        return self.session.request(method, self.base_url + path, timeout=5, **kwargs)


@pytest.fixture
def client_factory():
    clients = []
    base_url = os.environ.get("API_BASE_URL", "http://127.0.0.1:8080").rstrip("/")

    def create(identity=None):
        client = Api(base_url)
        clients.append(client)
        if identity:
            response = client.request("POST", "/api/session", json={"userId": identity})
            assert response.status_code == 200, response.text
        return client

    yield create
    for client in clients:
        client.session.close()


@pytest.fixture
def db():
    connection = pymysql.connect(
        host=os.environ.get("TEST_DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("TEST_DB_PORT", "3306")),
        user=os.environ.get("TEST_DB_USER", "workbench"),
        password=os.environ.get("TEST_DB_PASSWORD", "workbench-test"),
        database=os.environ.get("TEST_DB_NAME", "workbench_test"),
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )

    def query(sql, *params):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    try:
        yield query
    finally:
        connection.close()
