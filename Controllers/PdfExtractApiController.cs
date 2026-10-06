using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfExtractApiController : ControllerBase
{
    private readonly IPdfExtractService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfExtractApiController> _logger;

    public PdfExtractApiController(IPdfExtractService service, IOptions<PdfSettings> settings, ILogger<PdfExtractApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    /// <param name="pages">Pages à extraire, ex. « 1,3,5-8 ».</param>
    /// <param name="separate">true : un PDF par page dans un ZIP ; false : un seul PDF.</param>
    [HttpPost("extract")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Extract(
        [FromForm] IFormFile file,
        [FromForm] string pages,
        [FromForm] bool separate = false)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!_service.IsValidPdfHeader(file))
            return BadRequest(new { message = "Le fichier n'est pas un PDF valide." });

        try
        {
            var result = await _service.ExtractAsync(file, pages, separate);
            return File(result.Bytes, result.ContentType, result.FileName);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (PdfSharp.Pdf.IO.PdfReaderException ex)
        {
            _logger.LogWarning(ex, "Extraction : PDF invalide ou protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou protégé par mot de passe." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Extraction : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de l'extraction des pages." });
        }
    }
}
