(() => {
  const states = new Map();
  const card = () => '<div class="skeleton-card"><span class="skeleton icon" style="width:52px;height:52px"></span><span class="skeleton-lines"><i class="skeleton sk-title"></i><i class="skeleton sk-sub"></i></span><span><i class="skeleton sk-short"></i><i class="skeleton sk-time"></i></span></div>';

  function targets(page) {
    if (page === 'home') return [document.querySelector('#home .rows')];
    if (page === 'scenes') return [document.querySelector('#scenes .scene-list')];
    if (page === 'records') return [...document.querySelectorAll('#records .record-stat, #records .record-group, #records .record-list')];
    if (page === 'voice-workshop') return [...document.querySelectorAll('#voice-workshop .voice-card')];
    return [];
  }

  function clearLoading(page) {
    const state = states.get(page);
    if (!state) return;
    clearTimeout(state.showTimer);
    clearTimeout(state.doneTimer);
    state.nodes.forEach((node) => { node.style.display = node.dataset.beforeSkeleton || ''; });
    state.skeleton?.remove();
    states.delete(page);
  }

  function simulateLoading(page, duration = 1450) {
    clearLoading(page);
    const nodes = targets(page).filter(Boolean);
    if (!nodes.length) return;
    const state = {nodes, skeleton: null, showTimer: null, doneTimer: null};
    state.showTimer = setTimeout(() => {
      nodes.forEach((node) => {
        node.dataset.beforeSkeleton = node.style.display || '';
        node.style.display = 'none';
      });
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton-region skeleton-stack';
      skeleton.innerHTML = card() + card() + card();
      nodes[0].before(skeleton);
      state.skeleton = skeleton;
    }, 300);
    state.doneTimer = setTimeout(() => clearLoading(page), duration);
    states.set(page, state);
  }

  window.simulateLoading = simulateLoading;
  window.clearLoading = clearLoading;
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav button').forEach((button) => {
      button.addEventListener('click', () => simulateLoading(button.dataset.page));
    });
  });
})();
