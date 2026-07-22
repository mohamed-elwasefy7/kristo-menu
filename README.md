# كريستو — منيو رقمي فاخر

موقع منيو تفاعلي لمطعم **كريستو** (مأكولات لبنانية — المصيف، الرياض).
تجربة QR سينمائية: افتتاحية على خلفية التركواز، هيرو "اللوجو جه للحياة"، مقدمة لكل قسم، وكل صنف شاشة تحريرية كاملة. عربي/إنجليزي RTL، بدون أي framework — HTML/CSS/JS خام + GSAP محلي.

## التشغيل

الموقع يحتاج سيرفر محلي (ES Modules + fetch لا يعملان من `file://`):

- **الأسهل:** دبل كليك على `start.bat` → يفتح المتصفح على `http://localhost:4177`
- أو: `python -m http.server 4177` داخل مجلد المشروع

## تعديل المحتوى — كل شيء من `data/` بدون لمس الكود

| الملف | ماذا يعدّل |
|---|---|
| `data/prices.json` | **الأسعار** — ضع الرقم مكان `null` وسيظهر السعر تلقائياً. `null` = السعر مخفي |
| `data/menu.json` | الأصناف والمشروبات: الأسماء، الوصف، المكونات، الصورة، الجو اللوني (`background`)، البادجات |
| `data/categories.json` | الأقسام، ترتيبها، مقدماتها (العنوان والسطر الإنجليزي)، لون كل قسم |
| `data/settings.json` | روابط الطلب (كيتا / هنقرستيشن / نينجا / ذا شيفز) — الرابط الفارغ أو `REPLACE_ME` يُخفي الزر |
| `data/social.json` | واتساب / إنستجرام / تيك توك / سناب — الفارغ يُخفى |
| `data/brand.json` | الاسم، التاج لاين، الموقع، رابط الخرائط، ساعات العمل |
| `data/i18n.json` | نصوص الواجهة بالعربي والإنجليزي |
| `data/story.json` | نصوص شاشات الترحيب والطلب والختام |

### مثال: إضافة سعر
في `data/prices.json` غيّر:
```json
"manakish-zaatar": null   →   "manakish-zaatar": 12
```

## الصور

المصادر عالية الدقة (60MP) في `D:\chris\kristo menu\_extracted\`، والخريطة صنف→صورة في `tools/sources.json`.

```
python tools/optimize-images.py     # يولّد avif/webp/jpg بمقاسين لكل صنف
python tools/make-icons.py          # أيقونات PWA + og-image من assets/logo/logo-source.png
```

**اللوجو:** ضع الملف النظيف في `assets/logo/logo-source.png` ثم أعد تشغيل `make-icons.py` (بدونه يُستخدم mark مبسّط مؤقت).

## بعد أي تعديل CSS

```
python tools/build-css.py
```

الموقع يقرأ `css/bundle.min.css` فقط.

## نشر إنتاجي

```
python tools/build.py --base-url https://YOUR-DOMAIN
```

يبني `dist/` جاهز للرفع على GitHub Pages / Netlify / Vercel (والـ workflow في `.github/` ينشر تلقائياً على Pages).
