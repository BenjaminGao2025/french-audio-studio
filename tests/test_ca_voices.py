import unittest

CA = ["fr-CA-SylvieNeural", "fr-CA-JeanNeural", "fr-CA-AntoineNeural"]
SAMPLES = [
    "Bonjour.",
    "  Bonjour.  ",
    "la sûreté",
    "Ces droits sont la liberté, la propriété, la sûreté, et la résistance à l'oppression.",
    "",
    "Ça va ?",
]


def voice_for(text):
    """Reference FNV-1a (32-bit) over UTF-16 code units of the trimmed text, like the JS versions.
    (djb2 would not do: its multiplier 33 is divisible by 3, so h % 3 would only depend on the
    last character and nearly every sentence, ending in ".", would get the same voice.)"""
    key = text.strip()
    h = 0x811C9DC5
    data = key.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h = ((h ^ int.from_bytes(data[i : i + 2], "little")) * 16777619) & 0xFFFFFFFF
    return CA[h % 3]


class CanadianVoiceTests(unittest.TestCase):
    """Study and review playback use a Canadian voice chosen by a stable hash of the text."""

    def test_reference_hash_is_deterministic_and_varies(self):
        for text in SAMPLES:
            self.assertEqual(voice_for(text), voice_for(text))
        self.assertEqual(voice_for("Bonjour."), voice_for("  Bonjour.  "))
        # Sentences ending alike still spread over all three voices
        self.assertEqual(len({voice_for(f"Phrase numéro {i}.") for i in range(30)}), 3)

    def test_server_accepts_the_voices(self):
        import services.speech

        for voice in CA:
            self.assertIn(voice, services.speech.SUPPORTED_VOICES)


if __name__ == "__main__":
    unittest.main()
