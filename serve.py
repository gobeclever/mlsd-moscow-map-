"""Локальный сервер для предпросмотра карты (запускается из start_server.bat).

Отличие от `python -m http.server`: заголовок Cache-Control: no-store, чтобы
браузер не держал старые js/css/csv после обновления файлов.
"""
import http.server

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler).serve_forever()
