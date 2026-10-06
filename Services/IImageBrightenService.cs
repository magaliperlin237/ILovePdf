using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <summary>Paramètres d'éclaircissement d'une image.</summary>
/// <param name="Strength">Intensité de 0 à 100 (100 = éclaircissement maximal).</param>
/// <param name="Formats">Formats de sortie : pdf, png, jpg, webp, bmp, tiff.</param>
/// <param name="PdfPage">Mise en page du PDF : "a4" (image ajustée sur une page A4) ou "image" (page à la taille de l'image).</param>
public sealed record ImageBrightenOptions(
    int Strength,
    IReadOnlyList<string> Formats,
    string PdfPage);

/// <summary>Résultat : un fichier unique, ou une archive ZIP si plusieurs formats ont été demandés.</summary>
public sealed record BrightenResult(byte[] Bytes, string ContentType, string FileName);

public interface IImageBrightenService
{
    bool IsSupportedImage(IFormFile file);

    Task<BrightenResult> BrightenAsync(IFormFile file, ImageBrightenOptions options);
}
