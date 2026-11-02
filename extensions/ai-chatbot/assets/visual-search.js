document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.vs-block').forEach((root) => {
    const apiUrl = root.dataset.vsApi;
    if (!apiUrl) return;
    mountVisualSearch(root, apiUrl);
  });
});

function mountVisualSearch(root, apiUrl) {
  root.innerHTML = `
    <div class="vs-container">
      <h3 class="vs-title">Visual Search</h3>
      <p class="vs-sub">Upload a photo to find similar products</p>

      <div class="vs-upload">
        <input type="file" accept="image/*" class="vs-file-input" aria-label="Upload product photo">
        <label class="vs-label">Choose image</label>
        <img class="vs-preview" style="display:none;margin-top:12px;border-radius:8px;max-width:200px;max-height:200px">
        <button class="vs-remove" style="display:none;position:absolute;top:10px;right:10px;background:#ef4444;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">Remove</button>
      </div>

      <button class="vs-btn" disabled>Find Similar Products</button>
      <p class="vs-error"></p>
      <div class="vs-results"></div>
    </div>
  `;

  const fileInput = root.querySelector('.vs-file-input');
  const preview = root.querySelector('.vs-preview');
  const removeBtn = root.querySelector('.vs-remove');
  const searchBtn = root.querySelector('.vs-btn');
  const errorEl = root.querySelector('.vs-error');
  const resultsEl = root.querySelector('.vs-results');

  let selectedFile = null;

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    selectedFile = f;
    preview.src = URL.createObjectURL(f);
    preview.style.display = 'block';
    removeBtn.style.display = 'inline-block';
    searchBtn.disabled = false;
    errorEl.textContent = '';
    resultsEl.innerHTML = '';
  });

  removeBtn.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    preview.style.display = 'none';
    removeBtn.style.display = 'none';
    searchBtn.disabled = true;
    errorEl.textContent = '';
    resultsEl.innerHTML = '';
  });

  searchBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    errorEl.textContent = '';
    resultsEl.innerHTML = '';

    const formData = new FormData();
    formData.append('image', selectedFile);

    try {
      const res = await fetch(`${apiUrl}/api/visual-search`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) throw new Error('Search failed');
      const json = await res.json();
      const results = json.results || [];

      if (results.length === 0) {
        resultsEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#6b7280;font-size:14px;padding:20px">No similar products found.</p>';
      } else {
        resultsEl.innerHTML = results.map((item) => `
          <div class="vs-card">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" style="width:100%;height:140px;object-fit:cover;display:block">
            <div style="padding:8px">
              <div style="font-size:13px;font-weight:600;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</div>
              <div style="font-size:12px;color:#6b7280">Match: ${Math.round(item.score * 100)}%</div>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Find Similar Products';
    }
  });
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
