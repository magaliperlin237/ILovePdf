using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Globalization;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfRedactionApiController : ControllerBase
{
    private const int MaxRedactedPages = 500;

    private readonly IPdfRedactionService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfRedactionApiController> _logger;

    public PdfRedactionApiController(
        IPdfRedactionService service,
        IOptions<PdfSettings> settings,
        ILogger<PdfRedactionApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    /// <param name="file">PDF d'origine.</param>
    /// <param name="pageNumbers">Numéros de page caviardées (base 1), même ordre que images/widths/heights.</param>
    /// <param name="widths">Largeur de chaque page en points PDF.</param>
    /// <param name="heights">Hauteur de chaque page en points PDF.</param>
    /// <param name="images">Image aplatie de chaque page caviardée (JPEG ou PNG).</param>
    [HttpPost("redact")]
    [RequestSizeLimit(209_715_200)]
    [RequestFormLimits(MultipartBodyLengthLimit = 209_715_200)]
    public async Task<IActionResult> Redact(
        [FromForm] IFormFile file,
        [FromForm] List<int> pageNumbers,
        [FromForm] List<string> widths,
        [FromForm] List<string> heights,
        [FromForm] List<IFormFile> images)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!_service.IsValidPdfHeader(file))
            return BadRequest(new { message = "Le fichier n'est pas un PDF valide." });

        if (pageNumbers == null || pageNumbers.Count == 0)
            return BadRequest(new { message = "Aucune zone à caviarder n'a été définie." });

        if (pageNumbers.Count > MaxRedactedPages
            || pageNumbers.Count != widths.Count
            || pageNumbers.Count != heights.Count
            || pageNumbers.Count != images.Count
            || pageNumbers.Distinct().Count() != pageNumbers.Count)
        {
            return BadRequest(new { message = "Les données de caviardage sont incohérentes." });
        }

        var pages = new List<RedactedPage>(pageNumbers.Count);
        for (int i = 0; i < pageNumbers.Count; i++)
        {
            if (!double.TryParse(widths[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var w)
                || !double.TryParse(heights[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var h)
                || w < 10 || h < 10 || w > 14400 || h > 14400)
            {
                return BadRequest(new { message = "Dimensions de page invalides." });
            }

            var ext = Path.GetExtension(images[i].FileName);
            if (images[i].Length == 0
                || !(ext.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
                     || ext.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
                     || ext.Equals(".png", StringComparison.OrdinalIgnoreCase)))
            {
                return BadRequest(new { message = "Image de page invalide." });
            }

            pages.Add(new RedactedPage(pageNumbers[i], w, h, images[i]));
        }

        try
        {
            var bytes = await _service.ApplyRedactionsAsync(file, pages);
            return File(bytes, "application/pdf", $"caviarde_{DateTime.Now:yyyyMMddHHmmss}.pdf");
        }
        catch (Exception ex) when (ex is PdfSharp.Pdf.IO.PdfReaderException || ex is ArgumentException)
        {
            _logger.LogWarning(ex, "Caviardage : PDF invalide ou protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou protégé." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Caviardage : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors du caviardage." });
        }
    }
}
