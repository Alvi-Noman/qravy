# services/ai-waiter-service/vad.py
class Segmenter:
    def __init__(self, bytes_per_sec=16000*2, min_ms=500, max_ms=2000):
        self.buf = bytearray()
        self.bytes_per_sec = bytes_per_sec
        self.min = int(bytes_per_sec * (min_ms/1000))
        self.max = int(bytes_per_sec * (max_ms/1000))

    def push(self, chunk: bytes):
        self.buf.extend(chunk)
        # If we have at least max, emit a fixed-size chunk (streaming)
        if len(self.buf) >= self.max:
            out = bytes(self.buf[:self.max])
            self.buf = self.buf[self.max:]
            return out
        # Otherwise, as soon as we hit min, emit whatever we have (low latency)
        if len(self.buf) >= self.min:
            out = bytes(self.buf)
            self.buf.clear()
            return out
        return None

    def flush(self):
        if self.buf:
            out = bytes(self.buf)
            self.buf.clear()
            return out
        return None
