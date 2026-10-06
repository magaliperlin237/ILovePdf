using ILovePDF.Models;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Options;

namespace ILovePDF.Pages;

public class PdfCompareModel : PageModel
{
    private readonly PdfSettings _pdfSettings;

    public int MaxFileSizeMb => _pdfSettings.MaxFileSizeMb;

    public PdfCompareModel(IOptions<PdfSettings> pdfSettings)
    {
        _pdfSettings = pdfSettings.Value;
    }

    public void OnGet() { }
}
