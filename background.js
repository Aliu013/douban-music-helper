// Chrome MV3 service worker: use chrome.* APIs directly.
// Avoid importing webextension-polyfill here so background registration is as stable as possible.

console.log("background console starts");

const META_KEY = 'DoubanListingMetadata';
const extApi = (typeof chrome !== 'undefined' && chrome.runtime)
    ? chrome
    : (typeof browser !== 'undefined' && browser.runtime ? browser : null);

const lastRuntimeError = () => {
    try {
        return (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError)
            ? chrome.runtime.lastError
            : null;
    } catch (err) {
        return null;
    }
};


function normalizeDownloadUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let normalized = url.trim();
    if (!normalized) return null;
    if (normalized.startsWith('//')) normalized = 'https:' + normalized;
    try {
        const u = new URL(normalized);
        // 网易云封面常见格式：xxx.jpg?param=177y177；下载原图时去掉 param 更稳定。
        if (u.hostname.includes('music.126.net') && u.searchParams.has('param')) {
            u.searchParams.delete('param');
        }
        return u.href;
    } catch (err) {
        return normalized;
    }
}

function storageSet(items) {
    return new Promise((resolve, reject) => {
        if (!extApi || !extApi.storage || !extApi.storage.local) {
            reject(new Error('storage.local is not available'));
            return;
        }
        const ret = extApi.storage.local.set(items, () => {
            const err = lastRuntimeError();
            if (err) reject(new Error(err.message));
            else resolve();
        });
        // Firefox/webextension-polyfill may return a Promise instead of using callback.
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    });
}

function storageGet(key) {
    return new Promise((resolve, reject) => {
        if (!extApi || !extApi.storage || !extApi.storage.local) {
            reject(new Error('storage.local is not available'));
            return;
        }
        const ret = extApi.storage.local.get(key, (data) => {
            const err = lastRuntimeError();
            if (err) reject(new Error(err.message));
            else resolve(data || {});
        });
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    });
}

function downloadUrl(url) {
    return new Promise((resolve, reject) => {
        const downloadTarget = normalizeDownloadUrl(url);
        if (!downloadTarget) {
            resolve();
            return;
        }
        if (!extApi || !extApi.downloads || !extApi.downloads.download) {
            reject(new Error('downloads API is not available'));
            return;
        }
        console.log('Downloading image:', downloadTarget);
        const ret = extApi.downloads.download({
            url: downloadTarget,
            conflictAction: 'uniquify',
            saveAs: false
        }, (downloadId) => {
            const err = lastRuntimeError();
            if (err) reject(new Error(err.message));
            else resolve(downloadId);
        });
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    });
}

async function saveMeta(meta) {
    await storageSet({ [META_KEY]: meta });
}

async function getMeta() {
    const data = await storageGet(META_KEY);
    return data[META_KEY] || null;
}

async function handleMessage(msg, sender) {
    console.log("received content message:", msg);

    try {
        switch (msg.page) {
            case "bandcamp":
            case "discogs":
            case "apple":
            case "163":
                if (!msg.meta) {
                    console.warn("No meta received for page:", msg.page, msg);
                    return { ok: false, reason: "missing meta" };
                }

                const meta = JSON.parse(msg.meta);
                await saveMeta(meta);
                console.log("Metadata saved in background.", meta);

                if (meta.imgUrl) {
                    try {
                        await downloadUrl(meta.imgUrl);
                        console.log('Image downloaded');
                    } catch (error) {
                        console.log("Image download failed:", error);
                    }
                } else {
                    console.warn('No imgUrl found in metadata, skipped image download.', meta);
                }

                return { ok: true };

            case "douban-1":
            case "douban-2":
            case "douban-3":
                return { ok: true, meta: await getMeta() };

            default:
                return { ok: false, reason: "unknown page" };
        }
    } catch (err) {
        console.error("background message handler error:", err);
        return {
            ok: false,
            reason: err && err.message ? err.message : String(err)
        };
    }
}

if (!extApi || !extApi.runtime || !extApi.runtime.onMessage) {
    console.error('No extension runtime API available in background.');
} else {
    // Use Chrome's callback style explicitly. In MV3 service workers, returning true
    // keeps the message channel open while the async handler finishes.
    extApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        handleMessage(msg, sender)
            .then((response) => sendResponse(response))
            .catch((err) => {
                console.error('background message fatal error:', err);
                sendResponse({
                    ok: false,
                    reason: err && err.message ? err.message : String(err)
                });
            });
        return true;
    });
}

console.log("background console ends");
