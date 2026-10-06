namespace ILovePDF.Models;

public class PdfSettings
{
    public int MaxFileSizeMb { get; set; } = 50;
    public int MaxFiles { get; set; } = 20;

    public long MaxFileSizeBytes => MaxFileSizeMb * 1024L * 1024L;
}