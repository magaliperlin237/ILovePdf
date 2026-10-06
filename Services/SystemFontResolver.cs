using PdfSharp.Fonts;

namespace ILovePDF.Services;

/// <summary>
/// Résolveur de polices multiplateforme pour PDFsharp 6.x :
/// cherche un fichier .ttf sur le système (Windows, Linux, macOS).
/// </summary>
public sealed class SystemFontResolver : IFontResolver
{
    private static readonly string[] BoldCandidates =
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), "arialbd.ttf"),
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/TTF/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    };

    private static readonly string[] RegularCandidates =
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), "arial.ttf"),
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/TTF/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    };

    public FontResolverInfo? ResolveTypeface(string familyName, bool isBold, bool isItalic)
    {
        var path = (isBold ? BoldCandidates : RegularCandidates).FirstOrDefault(File.Exists)
                   ?? RegularCandidates.Concat(BoldCandidates).FirstOrDefault(File.Exists);

        if (path is null)
            throw new InvalidOperationException(
                "Aucune police TrueType trouvée sur le serveur. " +
                "Sous Linux/Docker, installez le paquet fonts-liberation (ou fonts-dejavu-core).");

        return new FontResolverInfo(path);
    }

    public byte[]? GetFont(string faceName) => File.ReadAllBytes(faceName);
}
