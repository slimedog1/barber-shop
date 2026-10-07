const photoSlots = [
  { key: "hero", label: "Başlıq şəkli" },
  { key: "gallery-1", label: "Qalereya · 1" },
  { key: "gallery-2", label: "Qalereya · 2" },
  { key: "gallery-3", label: "Qalereya · 3" },
  { key: "gallery-4", label: "Qalereya · 4" }
];

function setPhotoPreview(input) {
  const card = input.closest(".site-photo-card");
  if (input.files[0]) card.querySelector("img").src = URL.createObjectURL(input.files[0]);
}

async function loadContent() {
  const settings = await Admin.api("/api/admin/settings");
  const content = settings.siteContent;
  const about = document.querySelector("#about-form");
  for (const [key, value] of Object.entries(content.about)) about.elements[key].value = value;
  document.querySelector("#site-photos").innerHTML = photoSlots.map((slot) => {
    const url = slot.key === "hero" ? content.photos.hero : content.photos.gallery[Number(slot.key.slice(-1)) - 1];
    return `<article class="site-photo-card"><h3>${slot.label}</h3><img src="${Admin.escapeHtml(url)}" alt="${slot.label}" loading="lazy"><label>Yeni şəkil seç<input type="file" accept="image/*" data-site-photo="${slot.key}"></label><button class="button button-quiet" type="button" data-upload-site-image="${slot.key}">Şəkli yüklə <span>↑</span></button><p class="inline-message message" hidden></p></article>`;
  }).join("");
}

document.addEventListener("admin:ready", () => loadContent().catch(Admin.showError));
document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-site-photo]");
  if (input) setPhotoPreview(input);
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-upload-site-image]");
  if (!button) return;
  const key = button.dataset.uploadSiteImage;
  const card = button.closest(".site-photo-card");
  const file = card.querySelector("[data-site-photo]").files[0];
  const message = card.querySelector(".message");
  if (!file) {
    message.textContent = "Əvvəlcə şəkil seçin.";
    message.hidden = false;
    return;
  }
  button.disabled = true;
  try {
    await Admin.uploadImage(file, "site", key);
    message.hidden = true;
    await loadContent();
    Admin.showNotice("Şəkil yadda saxlanıldı.");
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  } finally { button.disabled = false; }
});

document.querySelector("#about-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#about-message");
  const about = Object.fromEntries(["kicker", "title", "paragraph1", "paragraph2", "note"].map((key) => [key, form.elements[key].value]));
  try {
    await Admin.api("/api/admin/site-content", { method: "PUT", body: JSON.stringify({ about }) });
    Admin.showNotice("Haqqımızda mətni yadda saxlanıldı.");
  } catch (error) { message.textContent = error.message; message.hidden = false; }
});
