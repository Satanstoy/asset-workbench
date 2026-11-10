from contextlib import contextmanager
import select
import socket
import socketserver
import threading


@contextmanager
def mysql_proxy(host, port):
    """Forward MySQL traffic while allowing a test to cut existing connections."""
    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True

        def __init__(self):
            self.lock = threading.Lock()
            self.connections = set()
            self.enabled = True
            super().__init__(("127.0.0.1", 0), Relay)

        def set_enabled(self, enabled):
            with self.lock:
                self.enabled = enabled
                if not enabled:
                    for connection in self.connections:
                        try:
                            connection.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass

    class Relay(socketserver.BaseRequestHandler):
        def handle(self):
            with self.server.lock:
                if not self.server.enabled:
                    return
                upstream = socket.create_connection((host, port), timeout=1)
                upstream.settimeout(None)
                pair = (self.request, upstream)
                self.server.connections.update(pair)
            try:
                while True:
                    ready, _, _ = select.select(pair, [], [])
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        destination = upstream if source is self.request else self.request
                        destination.sendall(data)
            except OSError:
                pass
            finally:
                with self.server.lock:
                    self.server.connections.difference_update(pair)
                upstream.close()

    with Server() as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield server
        finally:
            server.set_enabled(False)
            server.shutdown()
            thread.join()
