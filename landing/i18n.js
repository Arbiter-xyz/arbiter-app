/* Landing-page i18n (issue #8). Same model as app/src/i18n.js — catalogs,
   <html lang dir> switching, Intl number/currency formatting — kept as a
   classic script because the landing page is served as static files.
   English is the markup itself; other locales override by data-i18n key. */
(() => {
  "use strict";
  const RTL = ["ar", "he", "fa", "ur"];
  const CATALOGS = {
    ar: {
      skip: "تخطَّ إلى المحتوى الرئيسي",
      "lang.label": "اللغة",
      "nav.how": "كيف يعمل",
      "nav.features": "المزايا",
      "nav.developers": "المطوّرون",
      "nav.pricing": "الأسعار",
      "nav.faq": "الأسئلة الشائعة",
      "nav.docs": "اقرأ الوثائق",
      "hero.eyebrow": "حقيقة موثوقة لأي ادعاء تحتاج إلى التحقق منه · مبني على Stellar / Soroban",
      "hero.title": "هل هذا صحيح؟ ضع رهانًا على الإجابة.",
      "hero.sub": "يتحقق Arbiter من أي ادعاء تحتاج إلى إجابة حقيقية عنه — نتيجة تدقيق، أو سلوك عقد، أو خطأ ارتكبه الذكاء الاصطناعي — عبر نصاب بشري حقيقي مودِع للضمان، لا عبر تخمين نموذج لغوي. ادفع بمحفظة أو ببطاقة، واحصل على إجابة مسوّاة، أو استرداد كامل إن لم يتحقق الإجماع.",
      "hero.cta": "تحقّق من ادعاء مباشرة",
      "trust.price": "السعر المبدئي",
      "trust.staked": "بضمان",
      "trust.stakedSub": "نصاب، لا تخمين",
      "trust.fail": "آمن عند الفشل",
      "trust.failSub": "بالتصميم",
      "h.why": "لماذا Arbiter",
      "h.surge": "تسعير يراعي ذروة الطلب",
    },
  };
  const originals = new Map();
  const nodes = () => document.querySelectorAll("[data-i18n]");

  function apply(locale) {
    const dict = CATALOGS[locale] || {};
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL.includes(locale) ? "rtl" : "ltr";
    nodes().forEach((el) => {
      if (!originals.has(el)) originals.set(el, el.textContent);
      el.textContent = dict[el.dataset.i18n] || originals.get(el);
    });
    // Prices: USD via Intl so digits/separators/symbol placement are local.
    document.querySelectorAll("[data-i18n-price]").forEach((el) => {
      el.textContent = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" })
        .format(Number(el.dataset.i18nPrice));
    });
  }

  let locale = "en";
  try { locale = localStorage.getItem("arbiter_locale") || navigator.language.slice(0, 2); } catch (e) {}
  if (locale !== "en" && !CATALOGS[locale]) locale = "en";

  document.addEventListener("DOMContentLoaded", () => {
    const select = document.getElementById("lang-switch");
    if (select) {
      select.value = locale;
      select.addEventListener("change", () => {
        try { localStorage.setItem("arbiter_locale", select.value); } catch (e) {}
        apply(select.value);
      });
    }
    apply(locale);
  });
})();
