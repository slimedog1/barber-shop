const languageFields = [["az", "AZ"], ["ru", "RU"], ["en", "EN"]];

function translatedFields(kind, label, value = {}) {
  return `<fieldset class="translation-fields"><legend>${label}</legend>${languageFields.map(([language, short]) => `<label>${short}<input data-${kind}-${language} value="${Admin.escapeHtml(value[language] || "")}" required maxlength="100"></label>`).join("")}</fieldset>`;
}

function editorForm(barber) {
  return `<form class="barber-edit-form" data-edit-barber="${Admin.escapeHtml(barber._id)}"><div class="translation-grid">${translatedFields("name", "Ad", barber.name)}${translatedFields("role", "Vəzifə", barber.role)}</div><p class="inline-message message" hidden></p><button class="button button-quiet" type="submit">Dəyişiklikləri yadda saxla <span>→</span></button></form>`;
}

function renderBarbers(barbers) {
  const active = barbers.filter((barber) => barber.active !== false);
  const archived = barbers.filter((barber) => barber.active === false);
  document.querySelector("#barbers-list").innerHTML = active.length ? active.map((barber) => `<article class="barber-setting" data-barber="${Admin.escapeHtml(barber._id)}"><div class="barber-setting-heading"><div><h3>${Admin.escapeHtml(barber.name.az)}</h3><p class="muted">Aktiv · saytda görünür</p></div><button class="button button-quiet archive-button" type="button" data-archive-barber="${Admin.escapeHtml(barber._id)}">Arxivə köçür</button></div>${editorForm(barber)}</article>`).join("") : '<p class="empty">Aktiv bərbər yoxdur.</p>';
  const archiveSection = document.querySelector("#archived-barbers");
  archiveSection.innerHTML = archived.length ? `<details><summary>Arxivlənmiş bərbərlər <span class="archive-count">${archived.length}</span></summary><div class="archived-list">${archived.map((barber) => `<article class="barber-setting archived-barber"><div class="barber-setting-heading"><div><h3>${Admin.escapeHtml(barber.name.az)}</h3><p class="muted">Arxivdədir · saytda görünmür, əvvəlki görüşləri saxlanılır</p></div><button class="button button-quiet" type="button" data-reactivate-barber="${Admin.escapeHtml(barber._id)}">Yenidən aktiv et</button></div>${editorForm(barber)}</article>`).join("")}</div></details>` : "";
}

async function loadBarbers() {
  const settings = await Admin.api("/api/admin/settings");
  renderBarbers(settings.barbers || []);
}

  document.querySelector("#barber-form #new-barber-fields").innerHTML = `<div class="translation-grid">${translatedFields("name", "Ad")}${translatedFields("role", "Vəzifə")}</div>`;
document.addEventListener("admin:ready", () => loadBarbers().catch(Admin.showError));

document.querySelector("#barber-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const names = Object.fromEntries(languageFields.map(([language]) => [language, form.querySelector(`[data-name-${language}]`).value]));
  const roles = Object.fromEntries(languageFields.map(([language]) => [language, form.querySelector(`[data-role-${language}]`).value]));
  const message = document.querySelector("#barber-message");
  try {
    await Admin.api("/api/admin/barbers", { method: "POST", body: JSON.stringify({ name: names, role: roles }) });
    form.reset();
    message.hidden = true;
    await loadBarbers();
    Admin.showNotice("Bərbər əlavə edildi.");
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-edit-barber]");
  if (!form) return;
  event.preventDefault();
  const names = Object.fromEntries(languageFields.map(([language]) => [language, form.querySelector(`[data-name-${language}]`).value]));
  const roles = Object.fromEntries(languageFields.map(([language]) => [language, form.querySelector(`[data-role-${language}]`).value]));
  const message = form.querySelector(".inline-message");
  try {
    await Admin.api(`/api/admin/barbers/${encodeURIComponent(form.dataset.editBarber)}`, { method: "PATCH", body: JSON.stringify({ name: names, role: roles }) });
    await loadBarbers();
    Admin.showNotice("Bərbər məlumatları yadda saxlanıldı.");
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
});

document.addEventListener("click", async (event) => {
  const archive = event.target.closest("[data-archive-barber]");
  const reactivate = event.target.closest("[data-reactivate-barber]");
  if (!archive && !reactivate) return;
  const button = archive || reactivate;
  const active = Boolean(reactivate);
  try {
    await Admin.api(`/api/admin/barbers/${encodeURIComponent(button.dataset.archiveBarber || button.dataset.reactivateBarber)}`, { method: "PATCH", body: JSON.stringify({ active }) });
    await loadBarbers();
    Admin.showNotice(active ? "Bərbər yenidən aktiv edildi." : "Bərbər arxivə köçürüldü. Əvvəlki görüşlər saxlanıldı.");
  } catch (error) { Admin.showError(error); }
});
