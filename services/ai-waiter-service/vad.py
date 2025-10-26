class Segmenter:
    def __init__(self, bytes_per_sec=16000*2, min_ms=200, max_ms=600):
        self.buf = bytearray()
        self.bytes_per_sec = bytes_per_sec
        self.min = int(bytes_per_sec * (min_ms/1000))
        self.max = int(bytes_per_sec * (max_ms/1000))

    def push(self, chunk: bytes):
        self.buf.extend(chunk)
        if len(self.buf) >= self.min:
            if len(self.buf) >= self.max:
                out = bytes(self.buf[:self.max])
                self.buf = self.buf[self.max:]
                return out
        return None

    def flush(self):
        if self.buf:
            out = bytes(self.buf)
            self.buf.clear()
            return out
        return None
