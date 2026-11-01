using System.IO;

namespace Skyfront.Transport;

// Linked into both processes so scene packets cannot be accepted by the reader
// while being rejected by the WebView host. Counts are UTF-16 string characters,
// not bytes: JSON geometry/texture payloads are predominantly ASCII/base64.
internal static class NativeTransportPolicy
{
    internal const int MaxMessageCharacters = 128_000_000;
    internal const int MaxQueuedMessages = 64;

    internal static bool AcceptsMessageLength(int actualChars) =>
        actualChars >= 0 && actualChars <= MaxMessageCharacters;

    internal static void RequireMessageLength(int actualChars, string direction)
    {
        if (!AcceptsMessageLength(actualChars))
            throw new InvalidDataException($"{direction} message exceeded the native protocol size limit: actualChars={actualChars}, limitChars={MaxMessageCharacters}.");
    }
}
