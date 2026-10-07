const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const loginMessage = document.querySelector("#login-message");
const globalMessage = document.querySelector("#global-message");
const errorTranslations = {
  "Something went wrong. Please try again.": "Xəta baş verdi. Yenidən cəhd edin.",
  "Failed to fetch": "Serverlə əlaqə yaratmaq mümkün olmadı. Serverin işlədiyini yoxlayın.",
  "Username or password is incorrect.": "İstifadəçi adı və ya şifrə yanlışdır.",
  "Authentication required.": "Davam etmək üçün yenidən daxil olun.",
  "Cross-origin request rejected.": "Sorğu təhlükəsizlik səbəbi ilə rədd edildi.",
  "Not found.": "Məlumat tapılmadı.",
  "Invalid appointment.": "Görüş məlumatı yanlışdır.",
  "The appointment could not be canceled. It may have already started or been canceled.": "Görüş ləğv edilə bilmədi. Ola bilsin, artıq başlayıb və ya ləğv olunub.",
  "Provide opening hours for each day.": "Hər gün üçün iş saatlarını göstərin.",
  "Each open day needs a valid opening and closing time.": "Açıq günlər üçün düzgün açılış və bağlanış saatı daxil edin.",
  "Keep at least one day open.": "Ən azı bir iş günü açıq qalmalıdır.",
  "Enter a valid barber name.": "Düzgün bərbər adı daxil edin.",
  "Invalid barber status.": "Bərbərin statusu yanlışdır.",
  "Keep at least one active barber for online bookings.": "Onlayn görüşlər üçün ən azı bir bərbər aktiv qalmalıdır.",
  "Barber not found.": "Bərbər tapılmadı.",
  "Choose a date.": "Tarix seçin.",
  "Enter both times, or leave both blank for the full day.": "Hər iki saatı daxil edin və ya bütün günü bağlamaq üçün hər ikisini boş saxlayın.",
  "The reason is too long.": "Səbəb çox uzundur.",
  "Choose a valid barber.": "Mövcud bərbərlərdən birini seçin.",
  "Enter a valid time range.": "Düzgün vaxt aralığı daxil edin.",
  "Choose a future time.": "Gələcək tarix və saat seçin.",
  "There is already a confirmed appointment in that period. Cancel or move it before blocking this time.": "Bu vaxtda təsdiqlənmiş görüş var. Blok yaratmazdan əvvəl görüşü ləğv edin və ya başqa vaxta keçirin.",
  "Invalid time block.": "Vaxt bloku düzgün deyil.",
  "Time block not found.": "Vaxt bloku tapılmadı.",
  "Choose a valid appointment date.": "Düzgün görüş tarixi seçin."
};

function translateAdminError(message) {
  return errorTranslations[message] || message || "Xəta baş verdi. Yenidən cəhd edin.";
}

async function adminApi(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  } catch {
    throw Object.assign(new Error(errorTranslations["Failed to fetch"]), { status: 0 });
  }
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(translateAdminError(data.error || "")), { status: response.status });
  return data;
}

async function adminUploadImage(file, type, key) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Şəkil faylı seçin.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Şəkil 10 MB-dan kiçik olmalıdır.");
  const signature = await adminApi("/api/admin/images/signature", { method: "POST", body: JSON.stringify({ type, key }) });
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", signature.apiKey);
  form.append("timestamp", signature.timestamp);
  form.append("public_id", signature.publicId);
  form.append("overwrite", "true");
  form.append("signature", signature.signature);
  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(signature.cloudName)}/image/upload`, { method: "POST", body: form });
  } catch {
    throw new Error("Cloudinary ilə əlaqə yaratmaq mümkün olmadı.");
  }
  const uploaded = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Şəkli yükləmək mümkün olmadı. Faylın formatını yoxlayın.");
  await adminApi("/api/admin/images", { method: "POST", body: JSON.stringify({ type, key, publicId: uploaded.public_id, url: uploaded.secure_url }) });
  return uploaded.secure_url;
}

function adminEscape(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function adminShowError(error) {
  globalMessage.classList.remove("success-banner");
  globalMessage.textContent = error.status === 401 ? "Sessiyanın müddəti bitib. Yenidən daxil olun." : error.message;
  globalMessage.hidden = false;
  if (error.status === 401) {
    setAdminAuthenticated(false);
    loginMessage.textContent = "Sessiyanın müddəti bitib. Yenidən daxil olun.";
    loginMessage.hidden = false;
  }
  else {
    loginPanel.hidden = true;
    dashboard.hidden = false;
    document.querySelector("#admin-nav").hidden = false;
  }
}

function setAdminAuthenticated(authenticated) {
  loginPanel.hidden = authenticated;
  dashboard.hidden = !authenticated;
  if (authenticated) {
    const currentPath = window.location.pathname.replace(/\/$/, "") || "/admin/appointments";
    const links = [["/admin/appointments", "Görüşlər"], ["/admin/services", "Xidmətlər"], ["/admin/barbers", "Bərbərlər"], ["/admin/hours", "İş saatları"], ["/admin/blocks", "Vaxt blokları"], ["/admin/content", "Sayt məzmunu"]];
    const nav = document.querySelector("#admin-nav");
    nav.innerHTML = links.map(([url, label]) => `<a class="nav-tab${currentPath === url || (url === "/admin/appointments" && currentPath === "/admin") ? " active" : ""}" href="${url}">${label}</a>`).join("");
    nav.hidden = false;
    globalMessage.hidden = true;
    document.dispatchEvent(new CustomEvent("admin:ready"));
  }
}

window.Admin = { api: adminApi, escapeHtml: adminEscape, uploadImage: adminUploadImage, showError: adminShowError };
window.Admin.showNotice = (message) => {
  globalMessage.textContent = message;
  globalMessage.classList.add("success-banner");
  globalMessage.hidden = false;
};

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector("button");
  button.disabled = true;
  loginMessage.hidden = true;
  try {
    await adminApi("/api/admin/login", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
    form.reset();
    setAdminAuthenticated(true);
  } catch (error) {
    loginMessage.textContent = error.message;
    loginMessage.hidden = false;
  } finally { button.disabled = false; }
});

document.querySelector("#logout").addEventListener("click", async () => {
  try { await adminApi("/api/admin/logout", { method: "POST" }); setAdminAuthenticated(false); }
  catch (error) { adminShowError(error); }
});

adminApi("/api/admin/session").then(() => setAdminAuthenticated(true)).catch((error) => {
  if (error.status === 401) setAdminAuthenticated(false);
  else adminShowError(error);
});
