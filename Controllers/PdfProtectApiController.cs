using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfProtectApiController : ControllerBase
{
    private readonly IPdfProtectService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfProtectApiController> _logger;

    public PdfProtectApiController(IPdfProtectService service, IOptions<PdfSettings> settings, ILogger<PdfProtectApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    [HttpPost("protect")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Protect(
        [FromForm] IFormFile file,
        [FromForm] string password,
        [FromForm] string? ownerPassword = null,
        [FromForm] bool allowPrint = true,
        [FromForm] bool allowCopy = true,
        [FromForm] bool allowModify = false)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!PdfFileHelper.IsValidPdfHeader(file))
            return BadRequest(new { message = "Le fichier n'est pas un PDF valide." });

        try
        {
            var options = new PdfProtectOptions(password ?? string.Empty, ownerPassword, allowPrint, allowCopy, allowModify);
            var bytes = await _service.ProtectAsync(file, options);
            return File(bytes, "application/pdf", $"{PdfFileHelper.SafeBaseName(file.FileName)}_protege.pdf");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (PdfSharp.Pdf.IO.PdfReaderException ex)
        {
            // Aucun mot de passe n'est journalisé.
            _logger.LogWarning(ex, "Protection : PDF invalide ou déjà protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou déjà protégé par un mot de passe." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Protection : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de la protection du PDF." });
        }
    }
}
