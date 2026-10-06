using ILovePDF.Models;
using ILovePDF.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using System.Text.Json;

namespace ILovePDF.Controllers;

[ApiController]
[Route("api/pdf")]
public sealed class PdfSignApiController : ControllerBase
{
    private const long MaxSignatureBytes = 2 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly IPdfSignService _service;
    private readonly PdfSettings _settings;
    private readonly ILogger<PdfSignApiController> _logger;

    public PdfSignApiController(IPdfSignService service, IOptions<PdfSettings> settings, ILogger<PdfSignApiController> logger)
    {
        _service = service;
        _settings = settings.Value;
        _logger = logger;
    }

    /// <param name="file">PDF à signer.</param>
    /// <param name="signature">Image PNG de la signature (fond transparent).</param>
    /// <param name="placements">JSON : [{"page":1,"x":0.5,"y":0.8,"width":0.25,"height":0.1}] (fractions de la page).</param>
    [HttpPost("sign")]
    [RequestSizeLimit(104_857_600)]
    public async Task<IActionResult> Sign([FromForm] IFormFile file, [FromForm] IFormFile signature, [FromForm] string placements)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Veuillez sélectionner un fichier PDF." });

        if (file.Length > _settings.MaxFileSizeBytes)
            return BadRequest(new { message = $"Le fichier dépasse la taille maximale de {_settings.MaxFileSizeMb} Mo." });

        if (!PdfFileHelper.IsValidPdfHeader(file))
            return BadRequest(new { message = "Le fichier n'est pas un PDF valide." });

        if (signature == null || signature.Length == 0)
            return BadRequest(new { message = "La signature est manquante." });

        if (signature.Length > MaxSignatureBytes)
            return BadRequest(new { message = "L'image de la signature est trop volumineuse (2 Mo maximum)." });

        List<SignaturePlacement>? list;
        try
        {
            list = JsonSerializer.Deserialize<List<SignaturePlacement>>(placements ?? "[]", JsonOptions);
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "La liste des emplacements est invalide." });
        }

        try
        {
            var bytes = await _service.SignAsync(file, signature, list ?? new List<SignaturePlacement>());
            return File(bytes, "application/pdf", $"{PdfFileHelper.SafeBaseName(file.FileName)}_signe.pdf");
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex) when (ex is UnknownImageFormatException || ex is InvalidImageContentException || ex is NotSupportedException)
        {
            _logger.LogWarning(ex, "Signature : image invalide.");
            return BadRequest(new { message = "L'image de la signature ne peut pas être lue." });
        }
        catch (PdfSharp.Pdf.IO.PdfReaderException ex)
        {
            _logger.LogWarning(ex, "Signature : PDF invalide ou protégé.");
            return BadRequest(new { message = "Le fichier PDF ne peut pas être traité. Vérifiez qu'il n'est pas corrompu ou protégé par mot de passe." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Signature : erreur inattendue.");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Une erreur est survenue lors de la signature du PDF." });
        }
    }
}
