#!/usr/bin/env python3
"""Serves a language pack slowly, in many small pieces, so a download progress bar can be watched filling up.

Usage: slow-pack-server.py <pack-file> <port-file> [seconds=20] [pieces=20]

Listens on 127.0.0.1 (a free port, written to <port-file>). Every GET answers with the pack and the real
Content-Length, but the body arrives in <pieces> pieces spread over <seconds> (TCP_NODELAY, one flush per piece).
Loopback http is the only plain-http address a forge app accepts for downloads.
"""
import http.server
import socket
import sys
import time

pack_file, port_file = sys.argv[1], sys.argv[2]
seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 20.0
pieces = max(2, int(sys.argv[4])) if len(sys.argv) > 4 else 20
body = open(pack_file, 'rb').read()


class Slow(http.server.BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        step = max(1, -(-len(body) // pieces))
        for start in range(0, len(body), step):
            self.wfile.write(body[start:start + step])
            self.wfile.flush()
            if start + step < len(body):
                time.sleep(seconds / pieces)

    def log_message(self, *args):
        pass


httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Slow)
with open(port_file, 'w') as handle:
    handle.write(str(httpd.server_address[1]))
httpd.serve_forever()
