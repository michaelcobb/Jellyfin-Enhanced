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
            .je-music-result { text-align: left; background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 8px; padding: 12px 14px; cursor: pointer; color: #e2e8f0; }
            .je-music-result:hover { background: rgba(51, 65, 85, 0.8); }
            .je-music-result-name { font-weight: 600; display: block; }
            .je-music-result-meta { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; }
            .je-music-empty, .je-music-loading { color: #94a3b8; padding: 24px 0; text-align: center; }
            .je-music-back { background: none; border: none; color: #a5b4fc; cursor: pointer; padding: 0; margin-bottom: 12px; font-size: 0.9rem; }
            .je-music-artist-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
            .je-music-artist-name { font-size: 1.4rem; font-weight: 700; margin: 0; }
            .je-music-artist-meta { color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; margin-top: 4px; }
            .je-music-albums { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
            .je-music-album { background: rgba(30, 41, 59, 0.6); border-radius: 8px; padding: 10px 12px; }
            .je-music-album-title { font-weight: 600; display: block; }
            .je-music-album-year { color: #94a3b8; font-size: 0.8rem; }
            .je-music-search-card { background: none; border: none; padding: 0; text-align: left; font: inherit; color: inherit; cursor: pointer; }
            .je-music-card-image { position: relative; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #312e81, #7c3aed); color: rgba(255, 255, 255, 0.85); }
            .je-music-card-image > svg { width: 40%; height: 40%; }
            .je-music-card-overlay { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px; background: linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.8) 100%); opacity: 0; pointer-events: none; transition: opacity .18s ease; }
            .je-music-search-card .cardScalable:focus-within .je-music-card-overlay { opacity: 1; pointer-events: auto; }
            @media (hover: hover) {
                .je-music-search-card .cardScalable:hover .je-music-card-overlay { opacity: 1; pointer-events: auto; }
            }
            /* Touch devices have no hover: tapping the card opens the full
               overlay instead (see buildSearchRowCard), where Request is
               still one tap away. */
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
                    <span class="je-music-result-name">${JE.escapeHtml(artist.name)}</span>
                    <span class="je-music-result-meta">${JE.escapeHtml([artist.type, artist.country].filter(Boolean).join(' · '))}</span>
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
            <button class="je-music-back">&larr; ${t('music_back', 'Back to search')}</button>
            <div class="je-music-artist-header">
                <div>
                    <h3 class="je-music-artist-name">${JE.escapeHtml(artist.name)}</h3>
                    <div class="je-music-artist-meta">${JE.escapeHtml([artist.type, artist.country].filter(Boolean).join(' · '))}</div>
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
        document.getElementById(SEARCH_SECTION_ID)?.remove();
    }

    function buildSearchRowCard(artist) {
        // A div, not a button: it contains a real <button> (the request
        // button below), and a button cannot contain interactive content --
        // nesting one would make the browser's parser close this element
        // early and mangle the card's DOM. tabindex makes it focusable for
        // keyboard/:focus-within in place of the native button behavior.
        const card = document.createElement('div');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.className = 'card overflowPortraitCard card-hoverable je-music-search-card';
        card.setAttribute('data-mbid', artist.mbid);
        card.innerHTML = `
            <div class="cardBox cardBox-bottompadded">
                <div class="cardScalable">
                    <div class="cardPadder cardPadder-overflowPortrait"></div>
                    <div class="cardImageContainer je-music-card-image cardContent focusable" tabindex="-1">
                        ${MUSIC_ICON}
                        <div class="je-music-card-overlay"></div>
                    </div>
                </div>
                <div class="cardText cardTextCentered cardText-first">${JE.escapeHtml(artist.name)}</div>
                <div class="cardText cardTextCentered cardText-secondary">${JE.escapeHtml([artist.type, artist.country].filter(Boolean).join(' · '))}</div>
            </div>
        `;

        // Same interaction as the movie/show cards: hovering (or, on touch,
        // tapping once) reveals a Request button right on the card, so
        // requesting an artist takes one click instead of opening the full
        // overlay. The overlay above is still there for browsing an
        // artist's albums -- clicking the card anywhere outside the button
        // opens it.
        const requestButton = buildRequestButton(artist.mbid);
        card.querySelector('.je-music-card-overlay').appendChild(requestButton);

        card.addEventListener('click', (e) => {
            if (e.target.closest('.je-music-card-overlay')) return;
            openOverlay(artist.mbid);
        });
        card.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.je-music-card-overlay')) {
                e.preventDefault();
                openOverlay(artist.mbid);
            }
        });

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

    function runSearchRow(query) {
        if (searchRowAbort) searchRowAbort.abort();

        if (!query) {
            removeSearchRowSection();
            return;
        }

        searchRowAbort = new AbortController();
        const { signal } = searchRowAbort;

        JE.jellyseerrAPI.musicSearch(query, { signal }).then((data) => {
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

    /**
     * Wires up the "Discover Music on Seerr" row on Jellyfin's native search
     * page, alongside its existing movies/shows row. Safe to call once at
     * startup; re-attaches itself across SPA navigation.
     */
    JE.initializeMusicSearchSection = function() {
        if (!JE.pluginConfig?.JellyseerrEnabled) return;
        if (!JE.jellyseerrAPI?.musicSearch) return;

        attachNativeSearchListener();
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
