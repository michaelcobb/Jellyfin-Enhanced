// /js/jellyseerr/music.js
// Music search/discover/request — a header button that opens a small
// self-contained overlay for searching MusicBrainz artists and requesting
// one through the Seerr music patch (see api.musicSearch/fetchMusicArtist/
// requestArtist in api.js, proxied server-side via jellyseerr/music/*).
//
// Deliberately NOT built on top of modal.js/item-details.js/the discovery
// sections: those are all structured around a single TMDB movie/TV item
// (poster, backdrop, season picker, profile/root-folder form) and have no
// music equivalent. This is a small standalone overlay instead, styled to
// match but independent of that code, so it carries no risk of breaking
// (or being broken by) upstream changes to the movie/TV request flow.
(function(JE) {
    'use strict';

    const STYLE_ID = 'je-music-styles';
    const MUSIC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

    let overlay = null;
    let searchDebounce = null;
    let searchAbort = null;

    function t(key, fallback) {
        const translated = typeof JE.t === 'function' ? JE.t(key) : key;
        return translated === key ? fallback : translated;
    }

    // Mirrors ui-cards.js's isSafeTmdbImagePath: artist.imageUrl is server
    // data (proxied from Fanart.tv), but it still gets interpolated into a
    // CSS url() below -- reject anything that isn't a plain https URL with
    // no quotes/parens that could break out of that context.
    function isSafeArtistImageUrl(url) {
        return typeof url === 'string' && /^https:\/\/[^\s"'()]+$/.test(url);
    }

    // The same "POSTER NOT FOUND" placeholder ui-cards.js falls back to for a
    // movie/show with no TMDB poster (ctx.posterNotFoundUrl), proxied through
    // the plugin's own CDN cache. Called lazily -- JE.cdn is set up by
    // plugin.js before any card renders, but not necessarily before this
    // file is first parsed.
    function noPosterUrl() {
        return JE.cdn?.url?.('ibb', 'fdbkXQdP/jellyseerr-poster-not-found.png') || '';
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID) || !document.head) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .je-music-overlay { position: fixed; inset: 0; background: rgba(0, 10, 20, 0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
            .je-music-overlay.show { opacity: 1; pointer-events: all; }
            .je-music-panel { width: min(900px, 92vw); max-height: 82vh; background: rgba(15, 23, 42, 0.97); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
            .je-music-header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(51, 65, 85, 0.5); }
            .je-music-header input { flex: 1; background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 8px; color: #e2e8f0; padding: 10px 14px; font-size: 0.95rem; }
            .je-music-header input:focus { outline: none; border-color: #7c3aed; }
            .je-music-close { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px; }
            .je-music-close:hover { color: #e2e8f0; }
            .je-music-body { padding: 20px; overflow-y: auto; flex: 1; }
            .je-music-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
            .je-music-result { display: flex; align-items: center; gap: 10px; text-align: left; background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 8px; padding: 12px 14px; cursor: pointer; color: #e2e8f0; }
            .je-music-result:hover { background: rgba(51, 65, 85, 0.8); }
            .je-music-result-thumb { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; object-fit: cover; background: linear-gradient(135deg, #312e81, #7c3aed); display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, 0.85); }
            .je-music-result-thumb svg { width: 55%; height: 55%; }
            .je-music-result-text { display: flex; flex-direction: column; min-width: 0; }
            .je-music-result-name { font-weight: 600; display: block; }
            .je-music-result-meta { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; }
            .je-music-empty, .je-music-loading { color: #94a3b8; padding: 24px 0; text-align: center; }
            .je-music-back { background: none; border: none; color: #a5b4fc; cursor: pointer; padding: 0; margin-bottom: 12px; font-size: 0.9rem; }
            .je-music-backdrop { position: relative; margin: -20px -20px 16px; height: 160px; overflow: hidden; }
            .je-music-backdrop img { width: 100%; height: 100%; object-fit: cover; }
            .je-music-backdrop::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(15,23,42,0) 40%, rgba(15,23,42,1) 100%); }
            .je-music-artist-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
            .je-music-artist-header-main { display: flex; align-items: center; gap: 14px; }
            .je-music-artist-thumb { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(148, 163, 184, 0.3); }
            .je-music-artist-name { font-size: 1.4rem; font-weight: 700; margin: 0; }
            .je-music-artist-meta { color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; margin-top: 4px; }
            .je-music-albums { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
            .je-music-album { background: rgba(30, 41, 59, 0.6); border-radius: 8px; padding: 10px 12px; }
            .je-music-album-title { font-weight: 600; display: block; }
            .je-music-album-year { color: #94a3b8; font-size: 0.8rem; }
            /* Search-row cards reuse jellyseerr's own .jellyseerr-card /
               .jellyseerr-overview classes (ui-styles.js) so the hover
               mechanism, transitions and request-button styling are the
               exact ones movie/show cards use -- not a parallel copy. A
               missing artist photo falls back to the same "POSTER NOT
               FOUND" placeholder (noPosterUrl()) ui-cards.js uses for a
               movie/show with no TMDB poster, so no placeholder art of our
               own is needed here.
               Same .jellyseerr-media-badge chip ui-badges.js puts on movie/show
               posters (addMediaTypeBadge) -- only the colour is music-specific. */
            .jellyseerr-media-badge-music { background-color: #7c3aed; }
        `;
        document.head.appendChild(style);
    }

    /**
     * A Request button wired to JE.jellyseerrAPI.requestArtist, styled and
     * animated exactly like the movie/show cards' request button (same
     * classes/icons from jellyseerr's ui-icons.js/ui-styles.js). Used both
     * in the artist overlay and directly on search-row cards, so the two
     * surfaces behave identically instead of duplicating this logic.
     * @param {string} mbid
     * @param {{alreadyAdded?: boolean}} [opts]
     * @returns {HTMLButtonElement}
     */
    function buildRequestButton(mbid, { alreadyAdded = false } = {}) {
        const icons = JE.jellyseerrUI?.icons || {};
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `jellyseerr-request-button ${alreadyAdded ? 'jellyseerr-button-pending' : 'jellyseerr-button-request'}`;
        btn.disabled = alreadyAdded;
        btn.innerHTML = alreadyAdded
            ? `${icons.pending || icons.requested || ''}<span>${t('music_requested_button', 'Already Requested')}</span>`
            : `${icons.request || ''}<span>${t('music_request_button', 'Request')}</span>`;

        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = `<span>${t('music_requesting', 'Requesting…')}</span><span class="jellyseerr-button-spinner"></span>`;
            try {
                await JE.jellyseerrAPI.requestArtist(mbid);
                btn.classList.remove('jellyseerr-button-request');
                btn.classList.add('jellyseerr-button-pending');
                btn.innerHTML = `${icons.pending || icons.requested || ''}<span>${t('music_requested_button', 'Already Requested')}</span>`;
                JE.toast(t('music_request_success', 'Artist requested!'), 3000);
            } catch (error) {
                console.error('🪼 Jellyfin Enhanced: Music: request failed:', error);
                btn.disabled = false;
                btn.innerHTML = `${icons.request || ''}<span>${t('music_request_button', 'Request')}</span>`;
                JE.toast(t('music_request_error', 'Something went wrong requesting this artist.'), 3000);
            }
        });

        return btn;
    }

    /**
     * The same small circular refresh control jellyseerr.js's
     * createJellyseerrSection puts beside the movie/show "Discover on Seerr"
     * heading -- same classes/icon/animation, so it looks and behaves
     * identically. Clicking it dispatches 'je-music-manual-refresh', our own
     * row's analogue of jellyseerr.js's 'jellyseerr-manual-refresh', rather
     * than reusing that event name (the handler it triggers re-renders the
     * movie row's .jellyseerr-section, not ours).
     * @returns {HTMLButtonElement}
     */
    function buildRefreshButton() {
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'jellyseerr-refresh-btn';
        refreshBtn.setAttribute('aria-label', t('music_refresh_button', 'Refresh'));
        refreshBtn.title = t('music_refresh_button', 'Refresh');
        refreshBtn.style.marginLeft = '0.5em';
        refreshBtn.style.verticalAlign = 'middle';
        refreshBtn.style.background = 'none';
        refreshBtn.style.border = 'none';
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.style.display = 'inline-flex';
        refreshBtn.style.alignItems = 'center';
        refreshBtn.style.justifyContent = 'center';
        refreshBtn.style.padding = '0';
        const icon = document.createElement('span');
        icon.className = 'material-icons jellyseerr-refresh-icon';
        icon.textContent = 'refresh';
        icon.style.transition = 'transform 0.5s cubic-bezier(.4,2,.6,1)';
        refreshBtn.appendChild(icon);
        refreshBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            icon.style.transform = 'rotate(360deg)';
            setTimeout(() => { icon.style.transform = ''; }, 500);
            document.dispatchEvent(new CustomEvent('je-music-manual-refresh'));
        });
        // Same selectors/rules jellyseerr.js's section uses -- guarded by the
        // same style id so whichever row (movies or music) renders first is
        // the one that actually injects it; the second call is a no-op.
        if (!document.getElementById('jellyseerr-refresh-style')) {
            const style = document.createElement('style');
            style.id = 'jellyseerr-refresh-style';
            style.textContent = `
                .jellyseerr-refresh-btn:focus { outline: none; }
                .jellyseerr-refresh-icon { color: #fff; filter: opacity(0.6); }
                .jellyseerr-refresh-btn:hover .jellyseerr-refresh-icon { color: #fff; filter: opacity(0.9); }
            `;
            document.head.appendChild(style);
        }
        return refreshBtn;
    }

    function closeOverlay() {
        if (!overlay) return;
        overlay.classList.remove('show');
        setTimeout(() => overlay?.remove(), 300);
        overlay = null;
        if (searchAbort) searchAbort.abort();
    }

    function renderSearchView(body, query) {
        body.innerHTML = `
            <div class="je-music-results" id="je-music-results"></div>
        `;
        const resultsEl = body.querySelector('#je-music-results');
        if (!query) {
            resultsEl.innerHTML = '';
            return;
        }

        resultsEl.innerHTML = `<div class="je-music-loading">${t('music_searching', 'Searching…')}</div>`;

        if (searchAbort) searchAbort.abort();
        searchAbort = new AbortController();

        JE.jellyseerrAPI.musicSearch(query, { signal: searchAbort.signal }).then((data) => {
            const results = data?.results || [];
            if (!results.length) {
                resultsEl.innerHTML = `<div class="je-music-empty">${t('music_no_results', 'No artists found.')}</div>`;
                return;
            }

            resultsEl.innerHTML = results.map((artist) => `
                <button class="je-music-result" data-mbid="${JE.escapeHtml(artist.mbid)}">
                    ${artist.imageUrl
                        ? `<img class="je-music-result-thumb" src="${JE.escapeHtml(artist.imageUrl)}" alt="" loading="lazy">`
                        : `<span class="je-music-result-thumb">${MUSIC_ICON}</span>`}
                    <span class="je-music-result-text">
                        <span class="je-music-result-name">${JE.escapeHtml(artist.name)}</span>
                        <span class="je-music-result-meta">${JE.escapeHtml([artist.type, artist.country].filter(Boolean).join(' · '))}</span>
                    </span>
                </button>
            `).join('');

            resultsEl.querySelectorAll('.je-music-result').forEach((button) => {
                button.addEventListener('click', () => renderArtistView(body, button.dataset.mbid));
            });
        }).catch((error) => {
            if (error?.name === 'AbortError') return;
            resultsEl.innerHTML = `<div class="je-music-empty">${t('music_no_results', 'No artists found.')}</div>`;
        });
    }

    async function renderArtistView(body, mbid) {
        body.innerHTML = `<div class="je-music-loading">${t('music_searching', 'Loading…')}</div>`;
        const artist = await JE.jellyseerrAPI.fetchMusicArtist(mbid);

        if (!artist) {
            body.innerHTML = `<div class="je-music-empty">${t('music_no_results', 'Could not load this artist.')}</div>`;
            return;
        }

        const albumsHtml = (artist.releaseGroups || []).map((rg) => `
            <div class="je-music-album">
                <span class="je-music-album-title">${JE.escapeHtml(rg.title)}</span>
                ${rg.firstReleaseDate ? `<span class="je-music-album-year">${JE.escapeHtml(rg.firstReleaseDate.slice(0, 4))}</span>` : ''}
            </div>
        `).join('');

        body.innerHTML = `
            ${artist.backgroundUrl ? `
                <div class="je-music-backdrop">
                    <img src="${JE.escapeHtml(artist.backgroundUrl)}" alt="">
                </div>
            ` : ''}
            <button class="je-music-back">&larr; ${t('music_back', 'Back to search')}</button>
            <div class="je-music-artist-header">
                <div class="je-music-artist-header-main">
                    ${artist.imageUrl ? `<img class="je-music-artist-thumb" src="${JE.escapeHtml(artist.imageUrl)}" alt="">` : ''}
                    <div>
                        <h3 class="je-music-artist-name">${JE.escapeHtml(artist.name)}</h3>
                        <div class="je-music-artist-meta">${JE.escapeHtml([artist.type, artist.country].filter(Boolean).join(' · '))}</div>
                    </div>
                </div>
                <span class="je-music-request-slot"></span>
            </div>
            <div class="je-music-albums">${albumsHtml}</div>
        `;

        body.querySelector('.je-music-back').addEventListener('click', () => {
            const query = overlay?.querySelector('#je-music-input')?.value || '';
            renderSearchView(body, query);
        });

        const requestSlot = body.querySelector('.je-music-request-slot');
        if (artist.canRequest) {
            requestSlot.replaceWith(buildRequestButton(artist.mbid, { alreadyAdded: artist.alreadyAdded }));
        } else {
            requestSlot.outerHTML = `<span class="je-music-artist-meta">${t('music_no_lidarr', 'No Lidarr server is configured.')}</span>`;
        }
    }

    /**
     * Opens the music overlay. With an mbid, jumps straight to that artist's
     * detail view instead of the search box -- used by the native
     * search-page row below, where the user already picked an artist.
     * @param {string} [initialMbid]
     */
    function openOverlay(initialMbid) {
        if (overlay) {
            if (initialMbid) {
                const body = overlay.querySelector('.je-music-body');
                if (body) renderArtistView(body, initialMbid);
            }
            return;
        }
        injectStyles();

        overlay = document.createElement('div');
        overlay.className = 'je-music-overlay';
        overlay.innerHTML = `
            <div class="je-music-panel" role="dialog" aria-modal="true">
                <div class="je-music-header">
                    <input id="je-music-input" type="text" placeholder="${t('music_search_placeholder', 'Search for an artist…')}" autofocus />
                    <button class="je-music-close" aria-label="Close">&times;</button>
                </div>
                <div class="je-music-body"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));

        const body = overlay.querySelector('.je-music-body');
        const input = overlay.querySelector('#je-music-input');
        const close = () => closeOverlay();

        overlay.querySelector('.je-music-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
        });

        input.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => renderSearchView(body, input.value.trim()), 400);
        });

        if (initialMbid) {
            renderArtistView(body, initialMbid);
        } else {
            renderSearchView(body, '');
        }
    }

    // ================================
    // Artist "more info" modal
    // ================================
    // The movie/show "More Info" link opens JE.jellyseerrMoreInfo's modal --
    // a full detail page (backdrop, poster, stats panel, cast/crew) built
    // entirely around a TMDB id and TMDB-shaped data (seasons, ratings,
    // credits). Its open()/showModal() reach into that module's own
    // private `state`/`historyEntryActive` and call internal.renderActions,
    // internal.fetchMediaDetails, etc. -- all TMDB-specific and not meant to
    // be called with anything else, so there's no real "mechanism" there to
    // reuse for an artist beyond its *markup*: the .je-more-info-modal shell
    // and its CSS (more-info-modal-styles.js) make no assumption about what
    // data fills it in. This reuses that shell/CSS verbatim -- same classes,
    // same open/close choreography (backdrop click, Escape, X button, a
    // history entry so Back closes it) -- with its own scoped state, same
    // reasoning as the card hover mechanism above.
    let artistModal = null;
    let artistModalHistoryActive = false;
    let artistModalPopPending = false;

    function buildArtistModalContent(artist) {
        const metaParts = [artist.type, artist.country, artist.disambiguation].filter(Boolean);
        const backdropUrl = isSafeArtistImageUrl(artist.backgroundUrl) ? artist.backgroundUrl : '';
        const posterUrl = isSafeArtistImageUrl(artist.imageUrl) ? artist.imageUrl : noPosterUrl();
        const albums = artist.releaseGroups || [];

        return `
            <div class="modal-overlay">
                <div class="modal-container">
                    <button class="modal-refresh" aria-label="${t('music_refresh_button', 'Refresh')}" title="${t('music_refresh_button', 'Refresh status')}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36M20.49 15a9 9 0 0 1-14.85 3.36"></path>
                        </svg>
                    </button>
                    <button class="modal-close" aria-label="${t('music_close_button', 'Close')}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>

                    <div class="modal-backdrop"${backdropUrl ? ` style="background-image: url('${backdropUrl}');"` : ''}>
                        <div class="je-modal-backdrop-overlay"></div>
                    </div>

                    <div class="modal-content">
                        <div class="modal-main">
                            <div class="modal-left">
                                <div class="header-section">
                                    <div class="header-poster">
                                        <img src="${posterUrl}" alt="${JE.escapeHtml(artist.name)}" />
                                    </div>
                                    <div class="header-info">
                                        <div class="title-row">
                                            <h1 class="title">${JE.escapeHtml(artist.name)}</h1>
                                        </div>
                                        <div class="meta-info">
                                            ${metaParts.length
                                                ? metaParts.map((part) => `<span>${JE.escapeHtml(part)}</span>`).join('')
                                                : `<span>${t('music_card_overview', 'Discovered via MusicBrainz')}</span>`}
                                        </div>
                                        <div class="je-more-info-actions" data-mount="je-music-actions"></div>
                                    </div>
                                </div>

                                ${albums.length ? `
                                    <div class="cast-section">
                                        <h3>${t('music_discography', 'Discography')}</h3>
                                        <div class="cast-scroll">
                                            ${albums.map((rg) => `
                                                <div class="cast-member">
                                                    <div class="person-avatar">${MUSIC_ICON}</div>
                                                    <div class="person-name" title="${JE.escapeHtml(rg.title)}">${JE.escapeHtml(rg.title)}</div>
                                                    <div class="person-character">${rg.firstReleaseDate ? JE.escapeHtml(rg.firstReleaseDate.slice(0, 4)) : ''}</div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>

                            <div class="modal-right">
                                <div class="je-more-info-right-panel">
                                    <div class="je-more-info-stats-panel">
                                        ${artist.type ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_type', 'Type')}</div>
                                                <div class="je-more-info-stat-value">${JE.escapeHtml(artist.type)}</div>
                                            </div>
                                        ` : ''}
                                        ${artist.country ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_country', 'Country')}</div>
                                                <div class="je-more-info-stat-value">${JE.escapeHtml(artist.country)}</div>
                                            </div>
                                        ` : ''}
                                        ${artist.beginYear ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_formed', 'Formed')}</div>
                                                <div class="je-more-info-stat-value">${JE.escapeHtml(artist.beginYear)}${artist.endYear ? ` – ${JE.escapeHtml(artist.endYear)}` : ''}</div>
                                            </div>
                                        ` : ''}
                                        ${albums.length ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_albums', 'Albums')}</div>
                                                <div class="je-more-info-stat-value">${albums.length}</div>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderArtistModalActions(modal, artist) {
        const mount = modal.querySelector('[data-mount="je-music-actions"]');
        if (!mount) return;
        mount.innerHTML = '';
        if (artist.canRequest) {
            mount.appendChild(buildRequestButton(artist.mbid, { alreadyAdded: artist.alreadyAdded }));
        } else {
            const note = document.createElement('span');
            note.className = 'je-more-info-stat-value';
            note.textContent = t('music_no_lidarr', 'No Lidarr server is configured.');
            mount.appendChild(note);
        }
    }

    function closeArtistModal() {
        artistModalHistoryActive = false;
        artistModalPopPending = false;
        if (!artistModal) return;
        const closing = artistModal;
        artistModal = null;
        closing.classList.remove('active');
        if (closing._jeCleanup) closing._jeCleanup();
        setTimeout(() => closing.remove(), 300);
    }

    function dismissArtistModal() {
        if (!artistModalHistoryActive) {
            closeArtistModal();
            return;
        }
        if (artistModalPopPending) return;
        artistModalPopPending = true;
        history.back();
    }

    window.addEventListener('popstate', () => {
        if (!artistModalHistoryActive) return;
        artistModalHistoryActive = false;
        artistModalPopPending = false;
        closeArtistModal();
    });

    async function openArtistModal(mbid) {
        injectStyles();
        const artist = await JE.jellyseerrAPI.fetchMusicArtist(mbid);
        if (!artist) {
            JE.toast?.(t('music_no_results', 'Could not load this artist.'), 3000);
            return;
        }

        if (artistModal) closeArtistModal();

        const modal = document.createElement('div');
        modal.className = 'je-more-info-modal';
        modal.innerHTML = buildArtistModalContent(artist);
        document.body.appendChild(modal);
        artistModal = modal;
        renderArtistModalActions(modal, artist);

        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('modal-overlay')) {
                dismissArtistModal();
            }
        });
        modal.querySelector('.modal-close')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissArtistModal();
        });
        modal.querySelector('.modal-refresh')?.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.classList.add('loading');
            btn.disabled = true;
            try {
                const fresh = await JE.jellyseerrAPI.fetchMusicArtist(mbid);
                if (artistModal !== modal) return; // closed/replaced while refreshing
                if (fresh) renderArtistModalActions(modal, fresh);
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        });

        const handleEscape = (e) => { if (e.key === 'Escape') dismissArtistModal(); };
        document.addEventListener('keydown', handleEscape);
        modal._jeCleanup = () => document.removeEventListener('keydown', handleEscape);

        if (!artistModalHistoryActive) {
            history.pushState(null, '', location.href);
            artistModalHistoryActive = true;
        }

        requestAnimationFrame(() => modal.classList.add('active'));
    }

    // ================================
    // Native search-page integration
    // ================================
    // Mirrors jellyseerr.js's "Discover on Seerr" row for movies/shows, but
    // deliberately much simpler: no infinite scroll, pagination, or
    // collection lookups. MusicBrainz's first page of artist matches is
    // already a short, ranked list -- plenty for one horizontal row. Clicking
    // a card opens the overlay above straight to that artist, reusing all of
    // its request logic rather than duplicating it inline in the row.
    const SEARCH_SECTION_ID = 'je-music-search-section';
    let searchRowDebounce = null;
    let searchRowAbort = null;

    function removeSearchRowSection() {
        const section = document.getElementById(SEARCH_SECTION_ID);
        if (!section) return;
        // Drop state for the cards leaving the DOM (musicCardStates is a
        // plain Map, not a WeakMap, since it's read from delegated listeners
        // that need to look cards up by element).
        section.querySelectorAll('.jellyseerr-card').forEach((card) => musicCardStates.delete(card));
        section.remove();
    }

    // ---- Card hover-to-request, the same mechanism ui-cards.js uses for
    // movie/show cards -----------------------------------------------------
    // Reviewed ui-cards.js: the Request button that appears on hover is NOT
    // a pre-built overlay whose opacity CSS toggles. `.jellyseerr-overview`
    // is always `opacity:1; pointer-events:auto` -- the overview element
    // itself doesn't exist in the DOM until createOverview() builds and
    // appends it (to .cardScalable) on mouseenter/focus/tap, and
    // removeOverview() deletes it again on mouseleave. The is-touch/
    // focus-within/hover CSS rules in ui-styles.js are vestigial for that
    // reason. Listeners are bound once per container (not per card), via
    // capture-phase mouseenter/mouseleave (they don't bubble) plus click/
    // keydown/touch. This mirrors that exactly, scoped to our own search
    // row and its own state, instead of hooking into ui-cards.js's private
    // cardStates/container set.
    const musicCardStates = new Map();
    const boundMusicContainers = new WeakSet();

    function createCardOverview(state) {
        const overview = document.createElement('div');
        overview.className = 'jellyseerr-overview';
        overview.style.cursor = 'default';
        overview.innerHTML = `<div class="content">${JE.escapeHtml([state.artist.type, state.artist.country].filter(Boolean).join(' · ') || t('music_card_overview', 'Discovered via MusicBrainz'))}</div>`;
        state.overview = overview;
        state.cardScalable.appendChild(overview);
        state.button = buildRequestButton(state.artist.mbid);
        overview.appendChild(state.button);
    }

    function removeCardOverview(state) {
        if (state.overview?.parentNode) state.overview.parentNode.removeChild(state.overview);
        state.overview = null;
        state.button = null;
    }

    function musicCardEventTarget(container, e) {
        const target = e.target;
        if (!(target instanceof Element)) return null;
        const card = target.closest('.jellyseerr-card');
        if (!card || card.parentElement !== container) return null;
        const state = musicCardStates.get(card);
        return state ? { card, state, target } : null;
    }

    function onMusicCardHoverBoundary(container, e, entering) {
        const target = e.target;
        if (!(target instanceof Element) || !target.classList.contains('cardScalable')) return;
        const hit = musicCardEventTarget(container, e);
        if (!hit || target !== hit.state.cardScalable) return;
        if (entering) {
            if (!hit.state.overview) createCardOverview(hit.state);
        } else {
            removeCardOverview(hit.state);
        }
    }

    function onMusicCardClick(container, e) {
        const hit = musicCardEventTarget(container, e);
        if (!hit) return;
        const { state, target } = hit;
        if (target.closest('.jellyseerr-request-button')) return; // its own listener handles this
        if (target.closest('.jellyseerr-overview')) {
            // Background of the open overview (not the button): mirrors
            // ui-cards.js's onOverviewClick, whose click-through on the
            // overview area opens the detail modal.
            e.preventDefault();
            e.stopPropagation();
            openArtistModal(state.artist.mbid);
            return;
        }
        if (target.closest('.jellyseerr-more-info-link')) {
            e.preventDefault();
            e.stopPropagation();
            openArtistModal(state.artist.mbid);
            return;
        }
        if (target.closest('.jellyseerr-poster-image') === state.imageContainer) {
            // Mirrors ui-cards.js's onPosterClick: show the overview (so a
            // keyboard/touch user still sees the Request button if the modal
            // is dismissed) and open the detail modal, same as a movie poster.
            e.preventDefault();
            e.stopPropagation();
            if (!state.overview) createCardOverview(state);
            openArtistModal(state.artist.mbid);
        }
    }

    function onMusicCardKeydown(container, e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const hit = musicCardEventTarget(container, e);
        if (!hit || hit.target.closest('.jellyseerr-poster-image') !== hit.state.imageContainer) return;
        e.preventDefault();
        if (!hit.state.overview) createCardOverview(hit.state);
        else removeCardOverview(hit.state);
    }

    function addDelegatedTapListener(container, onTap) {
        let startX = 0, startY = 0, moved = false;
        container.addEventListener('touchstart', (e) => {
            const t0 = e.touches[0];
            startX = t0.clientX; startY = t0.clientY; moved = false;
        }, { passive: true });
        container.addEventListener('touchmove', (e) => {
            const t0 = e.touches[0];
            if (Math.abs(t0.clientX - startX) > 10 || Math.abs(t0.clientY - startY) > 10) moved = true;
        }, { passive: true });
        container.addEventListener('touchend', (e) => {
            if (moved) return;
            const hit = musicCardEventTarget(container, e);
            if (hit && hit.target.closest('.jellyseerr-poster-image') === hit.state.imageContainer) onTap(hit.state);
        }, { passive: true });
    }

    function bindMusicCardContainer(container) {
        if (boundMusicContainers.has(container)) return;
        boundMusicContainers.add(container);
        container.addEventListener('click', (e) => onMusicCardClick(container, e));
        container.addEventListener('keydown', (e) => onMusicCardKeydown(container, e));
        container.addEventListener('mouseenter', (e) => onMusicCardHoverBoundary(container, e, true), true);
        container.addEventListener('mouseleave', (e) => onMusicCardHoverBoundary(container, e, false), true);
        addDelegatedTapListener(container, (state) => {
            if (!state.overview) createCardOverview(state);
        });
    }

    /**
     * Builds a search-row card with the exact markup/classes
     * createJellyseerrCard uses for movie/show cards (.jellyseerr-card,
     * .cardScalable, .cardImageContainer.jellyseerr-poster-image,
     * .cardOverlayContainer, .jellyseerr-more-info-link) so the shared
     * hover-to-request mechanism above and all of ui-styles.js's card CSS
     * apply unmodified. Only the poster art (an icon instead of a photo)
     * is music-specific.
     * @param {Object} artist
     * @returns {HTMLElement}
     */
    function buildSearchRowCard(artist) {
        const card = document.createElement('div');
        card.className = 'card overflowPortraitCard card-hoverable card-withuserdata jellyseerr-card';
        card.setAttribute('data-mbid', artist.mbid);
        const posterUrl = isSafeArtistImageUrl(artist.imageUrl) ? artist.imageUrl : noPosterUrl();
        // Same meta row shape ui-cards.js's getCardTemplate uses for movie/show
        // cards (Seerr icon + year + star rating) rather than our own
        // type/country line, so the two rows read consistently. MusicBrainz
        // has no numeric rating, so that slot is always "N/A"; the year is
        // the artist's formation year (life-span.begin) when Seerr returns one.
        const year = artist.beginYear || t('music_meta_na', 'N/A');
        const rating = t('music_meta_na', 'N/A');
        const icons = JE.jellyseerrUI?.icons || {};
        card.innerHTML = `
            <div class="cardBox cardBox-bottompadded">
                <div class="cardScalable">
                    <div class="cardPadder cardPadder-overflowPortrait"></div>
                    <div class="cardImageContainer coveredImage cardContent jellyseerr-poster-image focusable" style="cursor: pointer; background-image: url('${posterUrl}');" tabindex="0">
                        <div class="jellyseerr-media-badge jellyseerr-media-badge-music">${JE.escapeHtml(t('music_card_badge', 'Music'))}</div>
                    </div>
                    <div class="cardOverlayContainer" style="pointer-events: none;"></div>
                </div>
                <div class="cardText cardTextCentered cardText-first">
                    <a is="emby-linkbutton" href="#" class="jellyseerr-more-info-link"><bdi>${JE.escapeHtml(artist.name)}</bdi></a>
                </div>
                <div class="cardText cardTextCentered cardText-secondary jellyseerr-meta">
                    <img class="jellyseerr-icon-on-card" src="${JE.cdn.selfhst('svg/seerr.svg')}" alt="Seerr">
                    <bdi>${JE.escapeHtml(year)}</bdi>
                    <div class="jellyseerr-rating">${icons.star || ''}<span>${JE.escapeHtml(rating)}</span></div>
                </div>
            </div>
        `;

        const cardScalable = card.querySelector('.cardScalable');
        const imageContainer = card.querySelector('.jellyseerr-poster-image');
        musicCardStates.set(card, { artist, cardScalable, imageContainer, overview: null, button: null });

        return card;
    }

    function renderSearchRowSection(results) {
        removeSearchRowSection();
        if (!results.length) return;
        injectStyles();

        const searchPage = document.querySelector('#searchPage:not(.hide)');
        if (!searchPage) return;

        const section = document.createElement('div');
        section.id = SEARCH_SECTION_ID;
        section.className = 'verticalSection emby-scroller-container je-music-search-section';

        const title = document.createElement('h2');
        title.className = 'sectionTitle sectionTitle-cards focuscontainer-x padded-left padded-right';
        title.textContent = t('music_discover_title', 'Discover Music on Seerr');
        title.appendChild(buildRefreshButton());
        section.appendChild(title);

        const scroller = document.createElement('div');
        scroller.setAttribute('is', 'emby-scroller');
        scroller.className = 'padded-top-focusscale padded-bottom-focusscale emby-scroller';
        scroller.dataset.horizontal = 'true';
        scroller.dataset.centerfocus = 'card';

        const itemsContainer = document.createElement('div');
        itemsContainer.setAttribute('is', 'emby-itemscontainer');
        itemsContainer.className = 'focuscontainer-x itemsContainer scrollSlider';
        results.forEach((artist) => itemsContainer.appendChild(buildSearchRowCard(artist)));
        bindMusicCardContainer(itemsContainer);
        scroller.appendChild(itemsContainer);
        section.appendChild(scroller);

        // Good-enough placement: right after the movies/shows "Discover on
        // Seerr" section when it's there, otherwise at the end of the
        // results. Fighting Jellyfin's own React re-renders for exact
        // ordering against its native People/Studios rows isn't worth it.
        const jellyseerrSection = searchPage.querySelector('.jellyseerr-section');
        if (jellyseerrSection) {
            jellyseerrSection.after(section);
            return;
        }
        const resultsContainer = searchPage.querySelector('.searchResults, [class*="searchResults"], .padded-top.padded-bottom-page');
        (resultsContainer || searchPage).appendChild(section);
    }

    function runSearchRow(query, { skipCache = false } = {}) {
        if (searchRowAbort) searchRowAbort.abort();

        if (!query) {
            removeSearchRowSection();
            return;
        }

        searchRowAbort = new AbortController();
        const { signal } = searchRowAbort;

        JE.jellyseerrAPI.musicSearch(query, { signal, skipCache }).then((data) => {
            if (signal.aborted) return;
            renderSearchRowSection(data?.results || []);
        }).catch((error) => {
            if (error?.name === 'AbortError') return;
            console.error('🪼 Jellyfin Enhanced: Music: search-row failed:', error);
            removeSearchRowSection();
        });
    }

    function handleNativeSearchInput(event) {
        const query = (event.target.value || '').trim();
        clearTimeout(searchRowDebounce);
        searchRowDebounce = setTimeout(() => runSearchRow(query), 400);
    }

    function attachNativeSearchListener() {
        const input = document.querySelector('#searchPage #searchTextInput');
        if (!input || input.dataset.jeMusicAttached) return;
        input.dataset.jeMusicAttached = 'true';
        input.addEventListener('input', handleNativeSearchInput);
        if (input.value.trim()) runSearchRow(input.value.trim());
    }

    function cleanupIfSearchPageGone() {
        if (!document.querySelector('#searchPage:not(.hide) #searchTextInput')) {
            removeSearchRowSection();
        }
    }

    // Mirrors jellyseerr.js's own 'jellyseerr-manual-refresh' listener
    // (manualRefreshJellyseerrData), scoped to our row: re-run the row's
    // current query bypassing the cache instead of touching .jellyseerr-section.
    let manualRefreshListenerAttached = false;
    function attachManualRefreshListener() {
        if (manualRefreshListenerAttached) return;
        manualRefreshListenerAttached = true;
        document.addEventListener('je-music-manual-refresh', () => {
            const input = document.querySelector('#searchPage #searchTextInput');
            const query = (input?.value || '').trim();
            if (query) runSearchRow(query, { skipCache: true });
        });
    }

    /**
     * Wires up the "Discover Music on Seerr" row on Jellyfin's native search
     * page, alongside its existing movies/shows row. Safe to call once at
     * startup; re-attaches itself across SPA navigation.
     */
    JE.initializeMusicSearchSection = function() {
        if (!JE.pluginConfig?.JellyseerrEnabled) return;
        if (!JE.jellyseerrAPI?.musicSearch) return;

        attachNativeSearchListener();
        attachManualRefreshListener();
        JE.core.dom.onBodyMutation('je-music-search-attach', () => {
            attachNativeSearchListener();
            cleanupIfSearchPageGone();
        });
        window.addEventListener('popstate', cleanupIfSearchPageGone);
        window.addEventListener('hashchange', cleanupIfSearchPageGone);
    };

    /**
     * Creates and injects the "Music" header button if the Seerr integration
     * is on. Mirrors JE.addRandomButton's mount pattern.
     */
    JE.addMusicButton = () => {
        if (!JE.pluginConfig?.JellyseerrEnabled) {
            document.getElementById('jeMusicButtonContainer')?.remove();
            return;
        }

        if (document.getElementById('jeMusicButton')) return;

        const headerRight = JE.helpers.getHeaderButtonTray();
        if (!headerRight || document.getElementById('jeMusicButton')) return;

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'jeMusicButtonContainer';

        const musicButton = document.createElement('button');
        musicButton.id = 'jeMusicButton';
        musicButton.setAttribute('is', 'paper-icon-button-light');
        musicButton.className = 'headerButton headerButtonRight paper-icon-button-light';
        musicButton.title = t('music_button_tooltip', 'Search and request music');
        musicButton.innerHTML = MUSIC_ICON;
        musicButton.addEventListener('click', () => openOverlay());

        buttonContainer.appendChild(musicButton);
        headerRight.prepend(buttonContainer);
    };
})(window.JellyfinEnhanced);
