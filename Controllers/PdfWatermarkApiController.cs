using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfWatermarkApiController : ControllerBase
{
    private static readonly Regex HexColor = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);
    private static readonly string[] AllowedModes = { "single", "tiled" };
    private static readonly string[] AllowedPositions = { "center", "top-left", "top-right", "bottom-left", "bottom-right" };

    private readonly IPdfWatermarkService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfWatermarkApiController> _logger;

    public PdfWatermarkApiController(IPdfWatermarkService service, IOptions<PdfSettings> settings, ILogger<PdfWatermarkApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    [HttpPost("watermark")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Watermark(
        [FromForm] IFormFile file,
        [FromForm] string text,
        [FromForm] int opacity = 25,
        [FromForm] double fontSize = 42,
        [FromForm] string position = "center",
        [FromForm] bool diagonal = true,
        [FromForm] string mode = "single",
        [FromForm] double angle = -35,
        [FromForm] double spacing = 50,
        [FromForm] bool stagger = true,
        [FromForm] string color = "#5A5A5A")
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF valide." });

        if (string.IsNullOrWhiteSpace(text))
            return BadRequest(new { message = "Le texte du filigrane est obligatoire." });

        mode = (mode ?? "single").Trim().ToLowerInvariant();
        if (!AllowedModes.Contains(mode))
            return BadRequest(new { message = "Le type de filigrane est invalide." });

        position = (position ?? "center").Trim().ToLowerInvariant();
        if (!AllowedPositions.Contains(position))
            return BadRequest(new { message = "La position du filigrane est invalide." });

        if (string.IsNullOrWhiteSpace(color) || !HexColor.IsMatch(color.Trim()))
            return BadRequest(new { message = "La couleur du filigrane est invalide." });

        if (double.IsNaN(angle) || double.IsInfinity(angle) || double.IsNaN(spacing) || double.IsInfinity(spacing)
            || double.IsNaN(fontSize) || double.IsInfinity(fontSize))
            return BadRequest(new { message = "Les paramètres du filigrane sont invalides." });

        try
        {
            var options = new PdfWatermarkOptions(
                Text: text.Trim(),
                Opacity: Math.Clamp(opacity, 5, 100) / 100.0,
                FontSize: Math.Clamp(fontSize, 8, 120),
                Color: color.Trim(),
                Mode: mode,
                Position: position,
                Diagonal: diagonal,
                Angle: Math.Clamp(angle, -90, 90),
                Spacing: Math.Clamp(spacing, 10, 100),
                Stagger: stagger);

            var bytes = await _service.AddWatermarkAsync(file, options);
            return File(bytes, "application/pdf", $"filigrane_{DateTime.Now:yyyyMMddHHmmss}.pdf");
        }
        catch (Exception ex) when (ex is PdfSharp.Pdf.IO.PdfReaderException || ex is ArgumentException)
        {
            _logger.LogWarning(ex, "Filigrane : PDF invalide ou protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou protégé." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Filigrane : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de l'ajout du filigrane." });
        }
    }
}
