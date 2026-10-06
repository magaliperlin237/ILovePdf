using Microsoft.AspNetCore.Http;

namespace ILovePDF.Services;

/// <summary>Paramètres d'un filigrane PDF.</summary>
/// <param name="Text">Texte du filigrane.</param>
/// <param name="Opacity">Opacité de 0.05 à 1.</param>
/// <param name="FontSize">Taille de police en points.</param>
/// <param name="Color">Couleur hexadécimale (#RRGGBB).</param>
/// <param name="Mode">"single" (un seul filigrane) ou "tiled" (répété sur toute la page).</param>
/// <param name="Position">Mode single : center, top-left, top-right, bottom-left, bottom-right.</param>
/// <param name="Diagonal">Mode single : incline le filigrane quand il est au centre.</param>
/// <param name="Angle">Angle de rotation en degrés (sens horaire positif).</param>
/// <param name="Spacing">Mode tiled : espacement de 10 à 100 (50 = standard).</param>
/// <param name="Stagger">Mode tiled : décale une ligne sur deux (effet « briques »).</param>
public sealed record PdfWatermarkOptions(
    string Text,
    double Opacity,
    double FontSize,
    string Color,
    string Mode,
    string Position,
    bool Diagonal,
    double Angle,
    double Spacing,
    bool Stagger);

public interface IPdfWatermarkService
{
    Task<byte[]> AddWatermarkAsync(IFormFile file, PdfWatermarkOptions options);
}
