//namespace ILovePDF
//{
//    public class Program
//    {
//        public static void Main(string[] args)
//        {
//            var builder = WebApplication.CreateBuilder(args);

//            // Add services to the container.
//            builder.Services.AddRazorPages();

//            var app = builder.Build();

//            // Configure the HTTP request pipeline.
//            if (!app.Environment.IsDevelopment())
//            {
//                app.UseExceptionHandler("/Error");
//                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
//                app.UseHsts();
//            }

//            app.UseHttpsRedirection();
//            app.UseStaticFiles();

//            app.UseRouting();

//            app.UseAuthorization();

//            app.MapRazorPages();

//            app.Run();
//        }
//    }
//}

using ILovePDF.Models;
using ILovePDF.Services;
using PdfSharp.Fonts;

// PDFsharp 6.x (build "core") ne trouve pas les polices tout seul :
// on lui fournit un résolveur qui marche sous Windows, Linux et macOS.
GlobalFontSettings.FontResolver = new SystemFontResolver();

var builder = WebApplication.CreateBuilder(args);

// Configuration des options
builder.Services.Configure<PdfSettings>(builder.Configuration.GetSection("PdfSettings"));

// Enregistrement des services
builder.Services.AddScoped<IPdfMergeService, PdfMergeService>();
builder.Services.AddScoped<IImageToPdfService, ImageToPdfService>();
builder.Services.AddScoped<IPdfWatermarkService, PdfWatermarkService>();
builder.Services.AddScoped<IPdfRedactionService, PdfRedactionService>();
builder.Services.AddScoped<IImageBrightenService, ImageBrightenService>();
builder.Services.AddScoped<IPdfExtractService, PdfExtractService>();
builder.Services.AddScoped<IPdfOrganizeService, PdfOrganizeService>();
builder.Services.AddScoped<IPdfPageNumberService, PdfPageNumberService>();
builder.Services.AddScoped<IPdfProtectService, PdfProtectService>();
builder.Services.AddScoped<IPdfCompressService, PdfCompressService>();
builder.Services.AddScoped<IPdfSignService, PdfSignService>();

// Activation de Razor Pages et des Controllers (pour l'API REST de fusion)
builder.Services.AddRazorPages();
builder.Services.AddControllers();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

app.MapRazorPages();
app.MapControllers(); // Pour l'API POST /api/pdf/merge

app.Run();
