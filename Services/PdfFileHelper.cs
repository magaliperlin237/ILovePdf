using Microsoft.AspNetCore.Http;
using System.Text;

namespace ILovePDF.Services;

/// <summary>Utilitaires partagés par les outils PDF.</summary>
public static class PdfFileHelper
{
    private static readonly byte[] PdfHeader = Encoding.ASCII.GetBytes("%PDF-");

    public static bool IsValidPdfHeader(IFormFile? file)
    {
        if (file == null || file.Length < 5)
            return false;

        using var stream = file.OpenReadStream();
        var buffer = new byte[5];
        var read = stream.Read(buffer, 0, 5);
        return read == 5 && buffer.SequenceEqual(PdfHeader);
    }

    /// <summary>Nom de fichier sans extension, débarrassé des caractères interdits.</summary>
    public static string SafeBaseName(string fileName, string fallback = "document")
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string(name.Where(c => !invalid.Contains(c)).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(clean) ? fallback : clean;
    }

    /// <summary>Convertit « #RRGGBB » en composantes ; gris foncé si le format est invalide.</summary>
    public static (int R, int G, int B) ParseColor(string? hex)
    {
        if (hex is { Length: 7 } && hex[0] == '#'
            && int.TryParse(hex.AsSpan(1), System.Globalization.NumberStyles.HexNumber, null, out var rgb))
        {
            return ((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
        }

        return (0x33, 0x33, 0x33);
    }
}
