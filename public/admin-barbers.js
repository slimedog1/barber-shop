function barberForm(barber) {
  return `<form class="barber-edit-form" data-edit-barber="${Admin.escapeHtml(barber._id)}">
    <div class="barber-photo-editor"><img src="${Admin.escapeHtml(barber.photoUrl || '')}" alt="${Admin.escapeHtml(barber.name)}" class="photo-preview"><label>Şəkli dəyiş<input type="file" accept="image/*" data-barber-photo></label></div>
    <div class="barber-fields"><label>Ad<input data-name value="${Admin.escapeHtml(barber.name)}" required maxlength="100"></label><label>Vəzifə<input data-role value="${Admin.escapeHtml(barber.role)}" required maxlength="100"></label></div>
    <p class="inline-message message" hidden></p><button class="button button-quiet" type="submit">Dəyişiklikləri yadda saxla <span>→</span></button>
  </form>`;
}

function renderBarbers(barbers) {
  const active = barbers.filter((barber) => barber.active !== false);
  const archived = barbers.filter((barber) => barber.active === false);
  document.querySelector("#barbers-list").innerHTML = active.length ? active.map((barber) => `<article class="barber-setting" data-barber="${Admin.escapeHtml(barber._id)}"><div class="barber-setting-heading"><div><h3>${Admin.escapeHtml(barber.name)}</h3><p class="muted">Aktiv · saytda görünür</p></div><button class="button button-quiet archive-button" type="button" data-archive-barber="${Admin.escapeHtml(barber._id)}">Arxivə köçür</button></div>${barberForm(barber)}</article>`).join("") : '<p class="empty">Aktiv bərbər yoxdur.</p>';
  const archiveSection = document.querySelector("#archived-barbers");
  archiveSection.innerHTML = archived.length ? `<details><summary>Arxivlənmiş bərbərlər <span class="archive-count">${archived.length}</span></summary><div class="archived-list">${archived.map((barber) => `<article class="barber-setting archived-barber"><div class="barber-setting-heading"><div><h3>${Admin.escapeHtml(barber.name)}</h3><p class="muted">Arxivdədir · saytda görünmür, əvvəlki görüşləri saxlanılır</p></div><button class="button button-quiet" type="button" data-reactivate-barber="${Admin.escapeHtml(barber._id)}">Yenidən aktiv et</button></div>${barberForm(barber)}</article>`).join("")}</div></details>` : "";
}

async function loadBarbers() {
  const settings = await Admin.api("/api/admin/settings");
  renderBarbers(settings.barbers || []);
}

document.addEventListener("admin:ready", () => loadBarbers().catch(Admin.showError));

document.querySelector("#barber-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#barber-message");
  try {
    const result = await Admin.api("/api/admin/barbers", { method: "POST", body: JSON.stringify({ name: form.querySelector("[name=name]").value, role: form.querySelector("[name=role]").value }) });
    const photo = form.querySelector("[name=photo]").files[0];
    form.reset();
    message.hidden = true;
    if (photo) {
      try { await Admin.uploadImage(photo, "barber", result.id); }
      catch (error) {
        await loadBarbers();
        Admin.showNotice(`Bərbər əlavə edildi, amma şəkil yüklənmədi: ${error.message}`);
        return;
      }
    }
    await loadBarbers();
    Admin.showNotice("Bərbər əlavə edildi.");
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-barber-photo], [name=photo]");
  if (!input || !input.files[0]) return;
  const preview = input.closest("form")?.querySelector(".photo-preview");
  if (preview) preview.src = URL.createObjectURL(input.files[0]);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-edit-barber]");
  if (!form) return;
  event.preventDefault();
  const message = form.querySelector(".inline-message");
  try {
    const photo = form.querySelector("[data-barber-photo]").files[0];
    if (photo) await Admin.uploadImage(photo, "barber", form.dataset.editBarber);
    await Admin.api(`/api/admin/barbers/${encodeURIComponent(form.dataset.editBarber)}`, { method: "PATCH", body: JSON.stringify({ name: form.querySelector("[data-name]").value, role: form.querySelector("[data-role]").value }) });
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
