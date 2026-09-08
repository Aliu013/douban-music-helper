console.log("sne - ",'content script starts');

// ====== Utilities ======

// === helper: choose default value if meta missing or not in options ===
const __withDefaultOption = (val, optionsMap, dflt) => {
  if (val && Object.prototype.hasOwnProperty.call(optionsMap, val)) return val;
  return dflt;
};


// === helper: normalize multiline text (remove leading blank lines, collapse extra blank lines) ===
const __normalizeMultiline = (txt) => {
  if (!txt) return txt;
  let s = txt.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' '); // \u00A0 = &nbsp;
  // Trim each line's edges
  s = s.split('\n').map(line => line.replace(/[ \t]+$/,'')).join('\n');
  // Remove leading blank lines
  s = s.replace(/^\s*\n\s*\n+/,'\n');
  // Collapse 2+ consecutive blank lines to a single blank line
  s = s.replace(/\n{3,}/g, '\n\n');
  // Final trim
  s = s.trim();
  return s;
};


// === helper: strip "number - " prefixes from each track line (keep pure titles) ===
const __stripNumberPrefix = (txt) => (txt||'')
  .split('\n')
  .map(s => s.replace(/^\s*\d+\s*[-–—\.]?\s*/, '').trim())
  .join('\n');


const __delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const __normalizeImageUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    let normalized = url.trim();
    if (!normalized) return null;
    if (normalized.startsWith('//')) normalized = window.location.protocol + normalized;
    try {
        const u = new URL(normalized, window.location.href);
        // 网易云封面常见格式：xxx.jpg?param=177y177；去掉 param 获取原图，避免固定 substr 长度导致 URL 被截坏。
        if (u.hostname.includes('music.126.net') && u.searchParams.has('param')) {
            u.searchParams.delete('param');
        }
        return u.href;
    } catch (err) {
        return normalized;
    }
};


let getCurrentPage=()=>{
    const host = (window.location.hostname || '').toLowerCase();
    let page;

    if (host === 'music.douban.com') {
        let nBasic=document.getElementsByClassName('basic').length;
        if (nBasic==2) page='douban-1';
        else if (nBasic>2) page='douban-2';
        else page='douban-3';
    } else if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) {
        page='bandcamp';
    } else if (host === 'www.discogs.com' || host === 'discogs.com') {
        page='discogs';
    } else if (host === 'music.apple.com') {
        page='apple';
    } else if (host === 'music.163.com' || host.endsWith('.music.163.com')) {
        page='163';
    }
    console.log('Douban-Music-Helper page:', page, window.location.href);
    return page;
}

const localStorageId='DoubanListingMetadata'


const __extApi = (typeof chrome !== 'undefined' && chrome.runtime)
    ? chrome
    : (typeof browser !== 'undefined' && browser.runtime ? browser : null);

const __lastRuntimeError = () => {
    try {
        return (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError)
            ? chrome.runtime.lastError
            : null;
    } catch (err) {
        return null;
    }
};

const __runtimeSendMessage = (payload) => new Promise((resolve, reject) => {
    if (!__extApi || !__extApi.runtime || !__extApi.runtime.sendMessage) {
        reject(new Error('runtime.sendMessage is not available'));
        return;
    }

    try {
        const ret = __extApi.runtime.sendMessage(payload, (response) => {
            const err = __lastRuntimeError();
            if (err) reject(new Error(err.message));
            else resolve(response);
        });

        // webextension-polyfill/browser.* returns a Promise and ignores the callback.
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    } catch (err) {
        reject(err);
    }
});


const __runtimeSendMessageWithRetry = async (payload, retries = 2) => {
    let lastError = null;
    for (let i = 0; i <= retries; i++) {
        try {
            return await __runtimeSendMessage(payload);
        } catch (err) {
            lastError = err;
            await __delay(300);
        }
    }
    throw lastError;
};

const __storageLocalSet = (items) => new Promise((resolve, reject) => {
    if (!__extApi || !__extApi.storage || !__extApi.storage.local) {
        reject(new Error('storage.local.set is not available'));
        return;
    }

    try {
        const ret = __extApi.storage.local.set(items, () => {
            const err = __lastRuntimeError();
            if (err) reject(new Error(err.message));
            else resolve();
        });
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    } catch (err) {
        reject(err);
    }
});

const __storageLocalGet = (key) => new Promise((resolve, reject) => {
    if (!__extApi || !__extApi.storage || !__extApi.storage.local) {
        reject(new Error('storage.local.get is not available'));
        return;
    }

    try {
        const ret = __extApi.storage.local.get(key, (data) => {
            const err = __lastRuntimeError();
            if (err) reject(new Error(err.message));
            else resolve((data || {})[key] || null);
        });
        if (ret && typeof ret.then === 'function') {
            ret.then((data) => resolve((data || {})[key] || null), reject);
        }
    } catch (err) {
        reject(err);
    }
});

const __saveMetaForDouban = async (currentPage, meta) => {
    try {
        const response = await __runtimeSendMessageWithRetry({
            page: currentPage,
            meta: JSON.stringify(meta)
        });

        if (!response || response.ok !== true) {
            throw new Error(response && response.reason ? response.reason : 'Failed to save metadata');
        }
        return response;
    } catch (err) {
        // The most common MV3 startup/reload failure is:
        // "Could not establish connection. Receiving end does not exist."
        // Save directly to extension storage so the Douban page can still read it.
        console.info('Background message failed; metadata saved through storage fallback; automatic image download may be skipped:', err && err.message ? err.message : err);
        await __storageLocalSet({ [localStorageId]: meta });
        return { ok: true, fallback: true };
    }
};

// ====== Douban ====== 

let fillDropdown=(dropdown, value, valueIndexMap)=>{
    let i=valueIndexMap[value];
    console.log(i);
    if (i || i==0) dropdown.getElementsByClassName('options')[0].getElementsByClassName('sub')[i].click();
}

// douban listing page 1
let fillDouban1=(meta, click=false) =>{ 
    console.log('sne,fillDouban1');
    console.log('sne,fillDouban1,meta',meta);
   
    document.getElementById('p_title').value=meta['album']; // album
    let button;
    if (meta['barcode']){
        console.log('have barcode');
        document.getElementById('uid').value=meta['barcode']; //barcode
        button=document.getElementsByClassName('submit')[0];
    } else{
        button=document.getElementsByClassName('btn-link')[0];
    }
    if (click) button.click();  //TODO: 保留，为了看log暂时注释
}

// douban listing page 2
// 添加条目页面，填充字段到页面信息
let fillDouban2=(meta,click=false) =>{
    document.getElementsByClassName('item basic')[0].getElementsByClassName('input_basic modified')[0].value=meta['album'];
    document.getElementsByClassName('item basic')[1].getElementsByClassName('datepicker input_basic hasDatepicker')[0].value=meta['date'];
    document.getElementsByClassName('item basic')[2].getElementsByClassName('input_basic')[0].value=meta['label'];
    document.getElementsByClassName('item basic')[3].getElementsByClassName('input_basic')[0].value=meta['numberOfDiscs'];
    document.getElementsByClassName('item basic')[4].getElementsByClassName('input_basic')[0].value=meta['isrc'];
    document.getElementsByClassName('item list')[0].getElementsByClassName('input_basic')[0].value=meta['albumAltName'];

    if (meta['artists']){  //TODO: more than 3 artists
        for (let i=0;i<Math.min(3,meta['artists'].length);i++){
            document.getElementsByClassName('item list musicians')[0].getElementsByClassName('input_basic')[i].value=meta['artists'][i];
        }
    }
    // items= // TODO
    fillDropdown(document.getElementsByClassName('dropdown')[0], // preserved
        __withDefaultOption(meta['genre'], {
'Blues': 0, 
                    'Classical': 1,
                    'EasyListening': 2, 
                    'Electronic': 3,
                    'Folk': 4, 
                    'FunkSoulRnB': 5,
                    'Jazz':6,
                    'Latin':7,
                    'Pop':8,
                    'Rap':9,
                    'Reggae': 10,
                    'Rock': 11,
                    'Soundtrack': 12,
                    'World': 13
                
        }, 'Rock'),
        {
'Blues': 0, 
                    'Classical': 1,
                    'EasyListening': 2, 
                    'Electronic': 3,
                    'Folk': 4, 
                    'FunkSoulRnB': 5,
                    'Jazz':6,
                    'Latin':7,
                    'Pop':8,
                    'Rap':9,
                    'Reggae': 10,
                    'Rock': 11,
                    'Soundtrack': 12,
                    'World': 13
                
        });
    fillDropdown(document.getElementsByClassName('dropdown')[1], // preserved
        __withDefaultOption(meta['releaseType'], {
'Album': 0, 
                    'Compilation': 1,
                    'EP': 2, 
                    'Single': 3,
                    'Bootleg': 4, 
                    'Video': 5
                
        }, 'Single'),
        {
'Album': 0, 
                    'Compilation': 1,
                    'EP': 2, 
                    'Single': 3,
                    'Bootleg': 4, 
                    'Video': 5
                
        });
    fillDropdown(document.getElementsByClassName('dropdown')[2], // preserved
        __withDefaultOption(meta['media'], {
'CD': 0, 
                    'Digital': 1,
                    'Cassette': 2, 
                    'Vinyl': 3
                
        }, 'Digital'),
        {
'CD': 0, 
                    'Digital': 1,
                    'Cassette': 2, 
                    'Vinyl': 3
                
        });
    document.getElementsByClassName('item text section')[0].getElementsByClassName('textarea_basic')[0].value= __stripNumberPrefix(meta['tracks']);
    document.getElementsByClassName('item text section')[1].getElementsByClassName('textarea_basic')[0].value=meta['description'];
    document.getElementsByClassName('item text section')[2].getElementsByClassName('textarea_basic')[0].value=meta['url'];

    if (click) document.getElementsByClassName('submit')[0].click();
}

// douban listing page 3
let fillDouban3=(meta,click=false) =>{ // TODO: auto-select image
    return null;
    
}



// ====== Bancamp/discogs/soundcloud/apple/163 ======

// 点击collect按钮
let createButton = (currentPage) => {
    const button = document.createElement("button");
    button.innerHTML = "Collect";
    button.style = "top:0;left:0;position:absolute;z-index:9999";

    button.onclick = async function () {
        const oldText = button.textContent;
        button.disabled = true;
        button.textContent = "Collect…";
        try {
            let meta = await collectMeta(currentPage);
            if (!meta) throw new Error('No metadata collected from current page');
            if (!meta.imgUrl) console.warn('No imgUrl collected; image download will be skipped.', meta);
            console.log('sne,meta', meta);

            await __saveMetaForDouban(currentPage, meta);

            // 再打开豆瓣新建条目页
            button.textContent = "Collect ✓";
            window.open("https://music.douban.com/new_subject");
        } catch (err) {
            console.error("Collect failed:", err);
            button.textContent = "Collect failed";
            button.title = err && err.message ? err.message : String(err);
            setTimeout(() => { button.textContent = oldText; }, 2200);
        } finally {
            button.disabled = false;
        }
    };

    document.body.appendChild(button);
}

let formatDate=(dateStr)=>{
    if (!dateStr) return null;
    const raw = String(dateStr).trim();
    if (!raw) return null;

    const monthNameMap={
        "jan":"01","feb":"02","mar":"03","apr":"04","may":"05","jun":"06","jul":"07","aug":"08","sep":"09","oct":"10","nov":"11","dec":"12",
        "january":"01","february":"02","march":"03","april":"04","may":"05","june":"06","july":"07","august":"08","september":"09","october":"10","november":"11","december":"12"
    };

    // yyyy-mm-dd / yyyy/mm/dd / yyyy.mm.dd / yyyy年mm月dd日
    let m = raw.match(/(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;

    // yyyy-mm / yyyy/mm / yyyy年mm月
    m = raw.match(/(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*月?/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-01`;

    // plain year
    m = raw.match(/\b(\d{4})\b/);
    const yearOnly = m && raw.replace(/\D/g,'').length === 4;
    if (yearOnly) return `${m[1]}-01-01`;

    // Month DD, YYYY / DD Month YYYY
    m = raw.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})/i);
    if (m && monthNameMap[m[1].toLowerCase()]) {
        return `${m[3]}-${monthNameMap[m[1].toLowerCase()]}-${m[2].padStart(2,'0')}`;
    }
    m = raw.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)[,]?\s+(\d{4})/i);
    if (m && monthNameMap[m[2].toLowerCase()]) {
        return `${m[3]}-${monthNameMap[m[2].toLowerCase()]}-${m[1].padStart(2,'0')}`;
    }

    // Last-resort normalization for older inputs.
    try{
        let spl=raw.split(/ ?[, 年月日] ?/).filter(n=>n);
        let month="01", day="01", year=null;
        if (spl.length==1){
            year=spl[0];
        } else if (spl.length==2){
            month=spl[0]; year=spl[1];
        } else if (spl.length>=3){
            if (/^\d{4}$/.test(spl[0])) {
                year=spl[0]; month=spl[1]; day=spl[2];
            } else {
                year=spl[2]; month=spl[0]; day=spl[1];
                if (monthNameMap[String(day).toLowerCase()]) { month=spl[1]; day=spl[0]; }
            }
        }
        month=String(month).padStart(2,'0').toLowerCase();
        if (monthNameMap[month]) month=monthNameMap[month];
        day=String(day).padStart(2,'0');
        if (year && /^\d{4}$/.test(String(year))) return `${year}-${month}-${day}`;
    } catch(err){}
    return null;
}

let collectMeta=async (currentPage) => {
    switch (currentPage){
        case "bandcamp":
            return collectBandcampMeta();
        case "discogs":
            return collectDiscogsMeta();
        case "soundcloud":
           return collectSoundcloudMeta();
        case "163":
            return await collectCloudMusicMeta();
        case "apple":
            return collectAppleMeta();
        default:
            return null
    }
}

let collectBandcampMeta=() =>{
    const creditsBlock=document.getElementsByClassName("tralbumData tralbum-credits")[0];
    const creditsText=__normalizeMultiline(creditsBlock ? (creditsBlock.innerText || creditsBlock.textContent) : '');
    const creditsLines=(creditsText || '').split('\n');
    if (creditsLines.length && /^released\s+/i.test(creditsLines[0])) creditsLines.shift();
    const productionStart=creditsLines.findIndex((line)=>/^Produit et réalisé par\b/i.test(line.trim()));
    const description=__normalizeMultiline((productionStart>=0 ? creditsLines.slice(productionStart) : creditsLines).join('\n'));

    const trackRows=Array.from(document.getElementById('track_table').children[0].getElementsByClassName("track_row_view"));
    const tracks=trackRows.map((ele,index) =>{
        const titleElement=ele.querySelector('.track-title');
        let title=titleElement ? titleElement.textContent.trim() : '';
        if (!title){
            title=ele.textContent
                .replace(/[\n\t ]+/g,' ')
                .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g,'')
                .replace(/ *buy track */,'')
                .replace(/ *lyrics */,'')
                .replace(/ *video */,'')
                .replace(/^\s*\d+\s*[.\-]?\s*/,'')
                .trim();
        }
        return title ? `${index+1} - ${title}` : null;
    }).filter(Boolean).join('\n');

    let out= {
        'url'           : document.URL,
        'album'         : document.getElementById('name-section').children[0].textContent.trim(),
        'barcode'       : null,
        'albumAltName'  : null,
        'artists'       : [document.getElementById('name-section').children[1].getElementsByTagName('span')[0].textContent.trim()],
        'genre'         : 'Rock',
        'releaseType'   : 'Album', // Not labeled on Bandcamp
        'media'         : 'Digital', // Not labeled on Bandcamp
        'date'          : (creditsText || '').split('\n')[0].replace(/^released\s+/i,''),
        'label'         : "Self-Released", // Bandcamp doesn't have a generic way for label
        'numberOfDiscs' : "1",
        'isrc'          : null,
        'tracks'        : tracks,
        'description'   : description,
        'imgUrl'        : document.getElementById('tralbumArt').children[0].href
    }
    out['date']=formatDate(out['date']);
    return out;
}

let collectDiscogsMeta=()=>{ // TODO
    let out={}
    let keys=['url' ,'album','barcode','albumAltName' ,'artists','genre','releaseType'  ,'media','date','label','numberOfDiscs','isrc','tracks','description'  ,'imgUrl' ]
    for (const key of keys) out[key]=null;

    let profileBlock=document.getElementsByClassName('profile')[0]
    out['url']= document.URL
    out['album']= profileBlock.children[0].children[1].textContent.trim()
    out['artists']=Array.from(profileBlock.children[0].children[0].children).map((ele)=>{return ele.title.trim()})
    out['media']='Vinyl'; // default
    out['label']='Self-Released'; //default
    const keyRenameMap={'Genre': 'genre', 'Year': 'date', "Format":"media","Released":'date', 'Label': 'label'};
    const valueRenameMap={'Hip Hop':'Rap'}
    for (let i=1;i<profileBlock.children.length-1;i+=2){ //This handles genre, media, date, label
        try{
            let key=profileBlock.children[i].textContent.replace(":","").trim();
            let value=profileBlock.children[i+1].children[0].textContent.trim(); // TODO: multiple genres, multiple labels, etc; empty entry
            key=keyRenameMap[key]
            if (key){
                if (valueRenameMap[value]) value=valueRenameMap[value];
                out[key]=value;
            }
        } catch (err){}
    }
    if (out['date']) out['date']=formatDate(out['date']);
    out['releaseType']='Album';
    out['numberOfDiscs']=1;
    // tracks

    let tracks=document.getElementById('tracklist').getElementsByTagName('tbody')[0]
    let trackText="";
    for (let i=0;i< tracks.children.length;i++){
        let track=tracks.children[i]
        let trackPos=(i+1).toString();
        let es=track.getElementsByClassName("tracklist_track_pos")
        if (es.length>0) trackPos=es[0].textContent.trim();
        let trackTitle=''
        es=track.getElementsByClassName("tracklist_track_title")
        if (es.length>0) trackTitle=es[0].textContent.trim();
        let trackDur=''
        es=track.getElementsByClassName("tracklist_track_duration")
        if (es.length>0) trackDur=es[0].textContent.trim();
        trackText+=`${trackPos} - ${trackTitle} ${trackDur}\n`
    }
    out['tracks']=trackText;

    out['description']=out['url']
    let noteBlock=document.getElementById('notes');
    if (noteBlock) out['description']+='\n\n'+noteBlock.children[1].textContent.trim();

    out['imgUrl']=JSON.parse(document.getElementById('page_content').getElementsByClassName("image_gallery")[0].attributes['data-images'].nodeValue)[0]['full'];

    return out;
}


let collectSoundcloudMeta=()=>{ // TODO
    return null
}

let collectAppleMeta=()=>{ // TODO
    let out={}
    let keys=['url' ,'album','barcode','albumAltName' ,'artists','genre','releaseType'  ,'media','date','label','numberOfDiscs','isrc','tracks','description'  ,'imgUrl' ]
    for (const key of keys) out[key]=null;

    out['url']= document.URL;
    out['album']=document.getElementsByClassName('headings')[0].children[0].textContent.trim();
    out['barcode']=null;
    out['artists']=[document.getElementsByClassName('headings')[0].children[1].textContent.trim()];
    let genre=document.getElementsByClassName('headings')[0].children[2].textContent.trim().split("·")[0].trim();
    const genreNameMap={'Dance':'Electronic','Hip-Hop':'Rap','HipHop':'Rap','Alternative':'Rock', "Hip-Hop/Rap":'Rap'};
    if (genre && genreNameMap[genre]) out['genre']=genreNameMap[genre];
    out['releaseType']='Album'; // TODO
    out['media']='Digital';
    // out['date']=document.getElementsByClassName("bottom-metadata")[0].getElementsByClassName('song-released-container')[0].textContent.replace("RELEASED",'').trim() // TODO:convert
    out['date']=document.getElementsByClassName("footer-body")[0].getElementsByClassName('description')[0].textContent.trim() // TODO:convert
    out['date']=formatDate(out['date']);
    try{
        out['label']=document.getElementsByClassName("bottom-metadata")[0].getElementsByClassName('song-copyright')[0].textContent.replace(/℗ \d+ /,'');
    } catch (err){}
    out['numberOfDiscs']="1";

    // tracks
    let tracksText="";
    let songs=document.getElementsByClassName("songs-list")[0].getElementsByClassName('song-name');
    for (i=0;i<songs.length;i++){
        tracksText+=`${i+1}. ${songs[i].textContent.trim()}\n`;
    } 
    out['tracks']=tracksText

    out['description']=out['url']
    try{
        out['description']='\n\n'+document.getElementsByClassName('product-page-header')[0].getElementsByClassName('truncated-content-container')[0].textContent.replace(/Editors’ Notes/,'').trim()
    } catch(err){}

    try{
        let _arr=document.getElementsByClassName('product-info')[0].getElementsByTagName('source')[1].srcset.split(" ");
        out['imgUrl']=_arr[_arr.length-2];
    } catch(err){}
    return out;
}

const __NETEASE_REQ = 'DOUBAN_HELPER_163_COLLECT_REQUEST';
const __NETEASE_RES = 'DOUBAN_HELPER_163_COLLECT_RESPONSE';

const __textAfterLabel = (text, labels) => {
    let s = (text || '').replace(/\s+/g, ' ').trim();
    for (const label of labels) {
        const re = new RegExp('^' + label + '\\s*[：:]?\\s*', 'i');
        if (re.test(s)) return s.replace(re, '').trim();
    }
    return null;
};

const __collectCloudMusicMetaFromDocument = (doc, sourceUrl=document.URL) => {
    console.log("Douban-Music-Helper: collecting NetEase metadata from frame", sourceUrl);
    let keys=['url' , 'album', 'barcode', 'albumAltName' , 'artists', 'genre', 'releaseType', 'media', 'date', 'label', 'numberOfDiscs', 'isrc', 'tracks', 'description', 'imgUrl'];
    let out={};
    for (const key of keys) out[key]=null;

    out['url'] = sourceUrl;
    out['releaseType'] = 'Album';
    out['media'] = 'Digital';
    out['numberOfDiscs'] = '1';

    const albumEl = doc.querySelector("h2.f-ff2, .m-info .tit h2, .cnt .hd h2, h2");
    if (albumEl) out['album'] = albumEl.textContent.trim();

    const infoLines = Array.from(doc.querySelectorAll('.m-info p.intr, .cnt p.intr, p.intr'));
    const artistLine = infoLines.find(el => /^\s*(歌手|艺术家|Artist)\s*[：:]/i.test(el.textContent || '')) || infoLines[0];
    if (artistLine) {
        const artistLinks = Array.from(artistLine.querySelectorAll('a'))
            .map(a => (a.textContent || a.getAttribute('title') || '').trim())
            .filter(Boolean);
        if (artistLinks.length) out['artists'] = [...new Set(artistLinks)];
        else {
            const artistText = __textAfterLabel(artistLine.textContent, ['歌手', '艺术家', 'Artist']);
            if (artistText) out['artists'] = [artistText];
        }
    }

    const dateLine = infoLines.find(el => /^\s*(发行时间|发布时间|Release(?:d)?(?: date)?)\s*[：:]/i.test(el.textContent || ''));
    if (dateLine) {
        const dateText = __textAfterLabel(dateLine.textContent, ['发行时间', '发布时间', 'Release(?:d)?(?: date)?']);
        out['date'] = formatDate(dateText);
    }

    const labelLine = infoLines.find(el => /^\s*(发行公司|唱片公司|厂牌|Label)\s*[：:]/i.test(el.textContent || ''));
    if (labelLine) {
        out['label'] = __textAfterLabel(labelLine.textContent, ['发行公司', '唱片公司', '厂牌', 'Label']);
    }
    if (!out['label'] && out['artists'] && out['artists'][0]) out['label'] = out['artists'][0];

    const rows = Array.from(doc.querySelectorAll('table tbody tr, .m-table tbody tr'));
    const trackLines = [];
    const cleanTrackTitle = (raw) => String(raw || '')
        .replace(/\u00A0/g, ' ')
        .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    for (let i=0; i<rows.length; i++) {
        const row = rows[i];

        // NetEase may inject random visible/hidden child text into <b>, while the
        // title attribute remains the canonical track name.  Read ONLY that
        // attribute when it exists; do not prefer innerText/textContent.
        const titleEl = row.querySelector(
            "td:nth-child(2) .ttc .txt > a > b[title], td:nth-child(2) .txt b[title], td:nth-child(2) b[title], .txt b[title]"
        );

        let title = titleEl ? cleanTrackTitle(titleEl.getAttribute('title')) : '';

        // Compatibility fallback for layouts that genuinely have no <b title>.
        // Keep this last so anti-scraping child nodes cannot override a clean title attr.
        if (!title) {
            const fallbackEl = row.querySelector('td:nth-child(2) .txt a, td:nth-child(2) a[href*="/song?id="], .txt a[href*="/song?id="]');
            title = fallbackEl ? cleanTrackTitle(fallbackEl.getAttribute('title') || fallbackEl.textContent) : '';
        }

        if (!title) continue;

        if (titleEl) {
            console.debug('Douban-Music-Helper: NetEase track title source', {
                titleAttr: titleEl.getAttribute('title'),
                textContent: titleEl.textContent,
                innerText: titleEl.innerText,
                chosen: title
            });
        }

        trackLines.push(`${trackLines.length + 1} - ${title}`);
    }
    out['tracks'] = trackLines.join('\n');

    const descMore = doc.getElementById('album-desc-more');
    const descDot = doc.getElementById('album-desc-dot');
    if (descMore) out['description'] = __normalizeMultiline(descMore.innerText);
    else if (descDot) out['description'] = __normalizeMultiline(descDot.innerText);
    else out['description'] = '';

    const coverImg = doc.querySelector("div.cover.u-cover.u-cover-alb > img, .u-cover img, img[src*='music.126.net']");
    if (coverImg) {
        const imgURL = coverImg.currentSrc || coverImg.src || coverImg.getAttribute('data-src') || coverImg.getAttribute('src');
        out['imgUrl'] = __normalizeImageUrl(imgURL);
    }

    if (!out['album']) throw new Error('网易云专辑页已加载，但没有找到专辑名；页面结构可能又发生了变化');
    if (!out['artists'] || !out['artists'].length) console.warn('Douban-Music-Helper: no artist found', out);
    if (!out['tracks']) console.warn('Douban-Music-Helper: no tracks found', out);
    console.log("Douban-Music-Helper NetEase metadata:", out);
    return out;
};

const __requestCloudMusicMetaFromIframe = (iframe, timeoutMs=2500) => new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let timer;

    const cleanup = () => {
        window.removeEventListener('message', onMessage);
        if (timer) clearTimeout(timer);
    };
    const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (!data || data.type !== __NETEASE_RES || data.requestId !== requestId) return;
        cleanup();
        if (data.ok && data.meta) resolve(data.meta);
        else reject(new Error(data.error || '网易云 iframe 采集失败'));
    };

    window.addEventListener('message', onMessage);
    timer = setTimeout(() => {
        cleanup();
        reject(new Error('等待网易云 iframe 响应超时'));
    }, timeoutMs);

    try {
        iframe.contentWindow.postMessage({ type: __NETEASE_REQ, requestId }, '*');
    } catch (err) {
        cleanup();
        reject(err);
    }
});

const __installCloudMusicFrameCollector = () => {
    if (window.top === window) return;
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.type !== __NETEASE_REQ || !data.requestId) return;
        try {
            const meta = __collectCloudMusicMetaFromDocument(document, document.URL || window.location.href);
            window.parent.postMessage({ type: __NETEASE_RES, requestId: data.requestId, ok: true, meta }, '*');
        } catch (err) {
            window.parent.postMessage({
                type: __NETEASE_RES,
                requestId: data.requestId,
                ok: false,
                error: err && err.message ? err.message : String(err)
            }, '*');
        }
    });
};

let collectCloudMusicMeta=async ()=>{
    // New path: the content script also runs inside matching frames and lets the frame
    // inspect its own DOM. This avoids relying on parent -> iframe DOM access.
    const iframe = document.getElementById('g_iframe');
    if (iframe && iframe.contentWindow) {
        try {
            return await __requestCloudMusicMetaFromIframe(iframe);
        } catch (bridgeErr) {
            console.warn('Douban-Music-Helper: iframe bridge failed; trying same-origin fallback.', bridgeErr);
            try {
                const frameDoc = iframe.contentDocument || iframe.contentWindow.document;
                if (frameDoc) return __collectCloudMusicMetaFromDocument(frameDoc, document.URL);
            } catch (sameOriginErr) {
                console.warn('Douban-Music-Helper: direct iframe fallback also failed.', sameOriginErr);
            }
        }
    }

    // Some NetEase layouts render album information directly in the top document.
    return __collectCloudMusicMetaFromDocument(document, document.URL);
};


// ====== Testing ======

let _metaTest={
    'album'         :'album'         ,
    'barcode'       : null           , //"727361514624"
    'albumAltName'  :'albumAltName'  ,
    'artists'       :['artist']       ,
    'genre'         :'genre'         ,
    'releaseType'   :'releaseType'   ,
    'media'         :'media'         ,
    'date'          :'date'          ,
    'label'         :'label'         ,
    'numOfDiscs'    :'numOfDiscs'    ,
    'isrc'          :'isrc'          ,
    'tracks'        :'tracks'        ,
    'description'   :'description'   
}

// console.log("Testing plugin");
// console.log(getCurrentPage());


// Register the iframe-side collector as early as possible. With manifest all_frames=true,
// this also runs in the NetEase album iframe.
__installCloudMusicFrameCollector();

// ====== Main ======

let currentPage=getCurrentPage();

let initDoubanPage = async () => {
    try {
        let response;
        try {
            response = await __runtimeSendMessageWithRetry({ page: currentPage });
        } catch (err) {
            console.info('Read metadata from background failed, trying storage fallback:', err && err.message ? err.message : err);
            const meta = await __storageLocalGet(localStorageId);
            response = { ok: true, meta };
        }

        if (!response || !response.meta) {
            return;
        }

        if (currentPage === 'douban-1') {
            fillDouban1(response.meta, click=true);
            localStorage.setItem(localStorageId, JSON.stringify(response.meta));
        }
    } catch (err) {
        console.error('Init douban page failed:', err);
    }
};

// Default action: add buttons to source pages, or init douban page
switch(currentPage){
    case 'bandcamp':
    case 'discogs':
    case 'apple':
        if (window.top === window) createButton(currentPage);
        break;
    case '163':
        if (window.top === window) createButton(currentPage);
        break;
    case 'douban-1':
    case 'douban-2':
    case 'douban-3':
        initDoubanPage();
        break;
}

// autofill douban-2 if meta is stored to localStorage
let metaStored=localStorage.getItem(localStorageId)
if (metaStored){
    console.log("sne - metaStored2");
    metaStored=JSON.parse(metaStored);
    if (currentPage=='douban-2'){
        fillDouban2(metaStored,click=false);
    }
    localStorage.removeItem(localStorageId);
}

console.log('content script ends');


// TODO
// https://www.discogs.com/Various-Sweet-House-Chicago/master/79323
// https://adaptedrecords.bandcamp.com/album/freedom
// https://music.apple.com/cn/album/%E6%90%96%E6%BB%BE86/1391495014 (date)
// get track duration on apple music
// https://www.discogs.com/Greekboy-Shaolin-Technics/release/11434711 (format)
// https://music.apple.com/us/album/the-palmwine-express/1491006159 (url)
// https://www.discogs.com/Various-Starship-The-De-Lite-Superstars/release/569725 (genre name map)
// https://www.discogs.com/Richard-Groove-Holmes-Soul-Power/release/2997598 (artist)
// [FIXED] bc track list sometimes has extra space (https://lbrecordings.bandcamp.com/album/l-b020-hyperromantic-isle-of-dead-ep)
// Master page on discogs grab label from the first release. 
// Recognize digital on discog from format like this https://www.discogs.com/DJ-Trax-Find-A-Way-EP/release/16466505 
// Recognize artist/duration on apple music like this https://music.apple.com/us/album/lo-fi-house-zip/1490994043
// Auto recognize EP in album title: https://how2make.bandcamp.com/album/vortex-ep
// Recognize label on bandcamp from side column (if label==artist then use self-released)
// Recognize "12''" on discogs https://www.discogs.com/Wax-Doctor-Cruise-Control-EP/release/90227 
// guess a release is EP/album by track count/track list numbering
// Multiple artists on bandcamp? 
// Add tags onto bandcamp description
