"""Static server with the headers multi-thread WASM needs."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8080), Handler)
    print("http://127.0.0.1:8080")
    server.serve_forever()


if __name__ == "__main__":
    main()
