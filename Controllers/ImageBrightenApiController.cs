using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/image")]
public sealed class ImageBrightenApiController : ControllerBase
{
    private static readonly string[] AllowedPdfPages = { "a4", "image" };

    private readonly IImageBrightenService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<ImageBrightenApiController> _logger;

    public ImageBrightenApiController(
        IImageBrightenService service,
        IOptions<PdfSettings> settings,
        ILogger<ImageBrightenApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    /// <param name="formats">Liste séparée par des virgules : pdf,png,jpg,webp,bmp,tiff.</param>
    [HttpPost("brighten")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Brighten(
        [FromForm] IFormFile file,
        [FromForm] string formats = "pdf",
        [FromForm] int strength = 100,
        [FromForm] string pdfPage = "a4")
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner une image." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!_service.IsSupportedImage(file))
            return BadRequest(new { message = "Format non supporté. Formats acceptés : JPG, PNG, BMP, WebP et TIFF." });

        var requested = (formats ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(f => f.ToLowerInvariant())
            .Distinct()
            .ToList();

        if (requested.Count == 0)
            return BadRequest(new { message = "Choisissez au moins un format de sortie." });

        if (requested.Any(f => !ImageBrightenService.AllowedFormats.Contains(f, StringComparer.OrdinalIgnoreCase)))
            return BadRequest(new { message = "Un des formats de sortie demandés est invalide." });

        pdfPage = (pdfPage ?? "a4").Trim().ToLowerInvariant();
        if (!AllowedPdfPages.Contains(pdfPage))
            return BadRequest(new { message = "La mise en page du PDF est invalide." });

        try
        {
            var options = new ImageBrightenOptions(Math.Clamp(strength, 0, 100), requested, pdfPage);
            var result = await _service.BrightenAsync(file, options);
            return File(result.Bytes, result.ContentType, result.FileName);
        }
        catch (Exception ex) when (ex is UnknownImageFormatException
                                   || ex is InvalidImageContentException
                                   || ex is NotSupportedException
                                   || ex is ArgumentException)
        {
            _logger.LogWarning(ex, "Éclaircissement : image invalide ou non supportée.");
            var message = ex is ArgumentException ? ex.Message : "L'image ne peut pas être lue. Vérifiez qu'elle n'est pas corrompue.";
            return BadRequest(new { message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Éclaircissement : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError,
                new { message = "Une erreur est survenue lors de l'éclaircissement de l'image." });
        }
    }
}
