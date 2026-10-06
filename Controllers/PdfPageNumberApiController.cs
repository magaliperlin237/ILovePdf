using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfPageNumberApiController : ControllerBase
{
    private static readonly Regex HexColor = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);

    private readonly IPdfPageNumberService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfPageNumberApiController> _logger;

    public PdfPageNumberApiController(IPdfPageNumberService service, IOptions<PdfSettings> settings, ILogger<PdfPageNumberApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    [HttpPost("number")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Number(
        [FromForm] IFormFile file,
        [FromForm] string position = "bottom-center",
        [FromForm] string format = "n",
        [FromForm] int start = 1,
        [FromForm] bool skipFirst = false,
        [FromForm] double fontSize = 11,
        [FromForm] string color = "#333333")
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!PdfFileHelper.IsValidPdfHeader(file))
            return BadRequest(new { message = "Le fichier n'est pas un PDF valide." });

        if (string.IsNullOrWhiteSpace(color) || !HexColor.IsMatch(color.Trim()))
            return BadRequest(new { message = "La couleur est invalide." });

        if (double.IsNaN(fontSize) || double.IsInfinity(fontSize))
            return BadRequest(new { message = "La taille de police est invalide." });

        try
        {
            var options = new PageNumberOptions(
                position ?? "bottom-center", format ?? "n", Math.Clamp(start, 0, 100000),
                skipFirst, Math.Clamp(fontSize, 6, 48), color.Trim());

            var bytes = await _service.AddPageNumbersAsync(file, options);
            return File(bytes, "application/pdf", $"{PdfFileHelper.SafeBaseName(file.FileName)}_numerote.pdf");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (PdfSharp.Pdf.IO.PdfReaderException ex)
        {
            _logger.LogWarning(ex, "Numérotation : PDF invalide ou protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou protégé par mot de passe." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Numérotation : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de la numérotation." });
        }
    }
}
