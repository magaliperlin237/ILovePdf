using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public class ImageToPdfApiController : ControllerBase
{
    private readonly IImageToPdfService _imageToPdfService;
    private readonly PdfSettings _pdfSettings;

    public ImageToPdfApiController(
        IImageToPdfService imageToPdfService,
        IOptions<PdfSettings> pdfSettings)
    {
        _imageToPdfService = imageToPdfService;
        _pdfSettings = pdfSettings.Value;
    }

    [HttpPost("image-to-pdf")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Convert(
        [FromForm] List<IFormFile> files,
        [FromForm] ImageCompressionLevel compressionLevel = ImageCompressionLevel.Medium,
        [FromForm] string? watermarkText = null,
        [FromForm] int watermarkOpacity = 25,
        [FromForm] int watermarkFontSize = 42,
        [FromForm] string watermarkPosition = "Center")
    {
        if (files == null || files.Count == 0)
        {
            return BadRequest(new { message = "Veuillez sélectionner au moins une image." });
        }

        if (files.Count > _pdfSettings.MaxFiles)
        {
            return BadRequest(new
            {
                message = $"Vous ne pouvez pas envoyer plus de {_pdfSettings.MaxFiles} images."
            });
        }

        foreach (var file in files)
        {
            if (file.Length == 0)
            {
                return BadRequest(new { message = $"Le fichier '{file.FileName}' est vide." });
            }

            if (file.Length > _pdfSettings.MaxFileSizeBytes)
            {
                return BadRequest(new
                {
                    message = $"Le fichier '{file.FileName}' dépasse la taille maximale autorisée de {_pdfSettings.MaxFileSizeMb} Mo."
                });
            }

            if (!_imageToPdfService.IsSupportedImage(file))
            {
                return BadRequest(new
                {
                    message = $"Le fichier '{file.FileName}' n'est pas une image supportée. Formats acceptés : JPG, JPEG, PNG et BMP."
                });
            }
        }

        if (!Enum.IsDefined(compressionLevel))
        {
            return BadRequest(new { message = "Le niveau de compression sélectionné est invalide." });
        }

        watermarkText = watermarkText?.Trim();
        if (!string.IsNullOrWhiteSpace(watermarkText) && watermarkText.Length > 100)
        {
            return BadRequest(new { message = "Le filigrane ne peut pas dépasser 100 caractères." });
        }

        watermarkOpacity = Math.Clamp(watermarkOpacity, 5, 80);
        watermarkFontSize = Math.Clamp(watermarkFontSize, 12, 120);

        var allowedPositions = new[] { "Center", "TopLeft", "TopRight", "BottomLeft", "BottomRight" };
        if (!allowedPositions.Contains(watermarkPosition, StringComparer.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "La position du filigrane est invalide." });
        }

        try
        {
            var watermark = string.IsNullOrWhiteSpace(watermarkText) ? null : new WatermarkOptions(
                watermarkText, watermarkOpacity, watermarkFontSize, watermarkPosition);

            var pdfBytes = await _imageToPdfService.ConvertToPdfAsync(files, compressionLevel, watermark);
            var fileName = $"images_vers_pdf_{DateTime.Now:yyyyMMddHHmmss}.pdf";

            return File(pdfBytes, "application/pdf", fileName);
        }
        catch (Exception)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                message = "Une erreur est survenue lors de la conversion des images en PDF."
            });
        }
    }
}
