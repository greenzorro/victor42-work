/*
 * File: main.js
 * Project: victor42-work
 * Author: Victor Cheng
 * Email: hi@victor42.work
 * Description: Product showcase — data-driven render, bilingual UI, theme toggle
 */

const SITE_ORIGIN = 'https://work.victor42.work';
const SITE_DATE_MODIFIED = '2026-07-20';
const DATA_URL = './data.json?v=20260717';

const UI_TEXT = {
    zh: {
        loading: '正在加载小玩意...',
        errorTitle: '😕 加载失败',
        errorMessage: '无法加载产品数据，请检查网络连接或稍后重试。',
        titleSuffix: '的创造营地 - 小玩意工具集合',
        visit: '访问',
        themeToggle: '切换深色模式',
        langToggle: '切换语言'
    },
    en: {
        loading: 'Loading gadgets...',
        errorTitle: '😕 Failed to load',
        errorMessage: 'Could not load product data. Please check your connection and try again.',
        titleSuffix: "'s Creations - Gadgets & Tools",
        visit: 'Visit',
        themeToggle: 'Toggle dark mode',
        langToggle: 'Switch language'
    }
};

let currentData = null;
let currentLanguage = 'zh';

document.addEventListener('DOMContentLoaded', function() {
    initializeLanguage();
    bindThemeControls();
    syncThemeIcon();
    loadProducts();
    initBackgrounds();
});

function initializeLanguage() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    const savedLang = localStorage.getItem('language');

    if (urlLang === 'zh' || urlLang === 'en') {
        currentLanguage = urlLang;
    } else if (savedLang === 'zh' || savedLang === 'en') {
        currentLanguage = savedLang;
    } else {
        currentLanguage = 'zh';
    }

    localStorage.setItem('language', currentLanguage);
    updateLanguageButton();
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';
    applyStaticUiText();

    const langToggle = document.getElementById('lang-toggle');
    if (langToggle) {
        langToggle.addEventListener('click', toggleLanguage);
    }
}

function toggleLanguage() {
    setLanguage(currentLanguage === 'zh' ? 'en' : 'zh');
}

function setLanguage(lang) {
    if (lang !== 'zh' && lang !== 'en') return;

    currentLanguage = lang;
    localStorage.setItem('language', lang);

    const url = new URL(window.location);
    url.searchParams.set('lang', lang);
    window.history.replaceState({}, '', url);

    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    updateLanguageButton();
    applyStaticUiText();

    if (currentData) {
        renderPage(currentData);
    }

    updateMetaTags(lang);
}

function updateLanguageButton() {
    const langText = document.querySelector('.lang-text');
    if (langText) {
        langText.textContent = currentLanguage === 'zh' ? 'EN' : '中文';
    }
}

function applyStaticUiText() {
    const t = UI_TEXT[currentLanguage];
    const loadingText = document.getElementById('loading-text');
    const errorTitle = document.getElementById('error-title');
    const errorMessage = document.getElementById('error-message');
    const themeToggle = document.getElementById('theme-toggle');
    const langToggle = document.getElementById('lang-toggle');

    if (loadingText) loadingText.textContent = t.loading;
    if (errorTitle) errorTitle.textContent = t.errorTitle;
    if (errorMessage) errorMessage.textContent = t.errorMessage;
    if (themeToggle) themeToggle.setAttribute('aria-label', t.themeToggle);
    if (langToggle) langToggle.setAttribute('aria-label', t.langToggle);
}

function getText(textObj) {
    if (typeof textObj === 'object' && textObj !== null) {
        return textObj[currentLanguage] || textObj.zh || '';
    }
    return '';
}

function toAbsoluteUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const normalized = path.replace(/^\.\//, '').replace(/^\//, '');
    return `${SITE_ORIGIN}/${normalized}`;
}

function updateMetaTags(lang) {
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');

    if (!currentData) return;

    const title = getText(currentData.title);
    const fullTitle = `${title}${UI_TEXT[lang].titleSuffix}`;
    const description = getText(currentData.description);

    const titleElement = document.getElementById('page-title');
    if (titleElement) {
        titleElement.textContent = fullTitle;
    }
    document.title = fullTitle;

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
        metaDescription.setAttribute('content', description);
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogTitle) ogTitle.setAttribute('content', fullTitle);
    if (ogDescription) ogDescription.setAttribute('content', description);
    if (ogLocale) ogLocale.setAttribute('content', lang === 'zh' ? 'zh_CN' : 'en_US');

    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    const twitterDescription = document.querySelector('meta[name="twitter:description"]');
    if (twitterTitle) twitterTitle.setAttribute('content', fullTitle);
    if (twitterDescription) twitterDescription.setAttribute('content', description);
}

function updateStructuredData(data) {
    const script = document.getElementById('structured-data');
    if (!script) return;

    const itemListElement = data.products.map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
            '@type': 'SoftwareApplication',
            name: getText(product.name),
            description: getText(product.description),
            url: product.url,
            applicationCategory: 'WebApplication',
            operatingSystem: 'Web',
            ...(product.image ? { image: toAbsoluteUrl(product.image) } : {})
        }
    }));

    const payload = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: currentLanguage === 'zh' ? 'Victor42的创造营地' : "Victor42's Creations",
        alternateName: 'Victor42 Work Tools',
        url: `${SITE_ORIGIN}/`,
        description: getText(data.description),
        author: {
            '@type': 'Person',
            name: 'Victor42',
            url: data.profile.website.url,
            image: toAbsoluteUrl(data.profile.avatar),
            jobTitle: 'UI/UX Designer & Developer',
            description: getText(data.profile.bio)
        },
        publisher: {
            '@type': 'Person',
            name: 'Victor42',
            url: data.profile.website.url
        },
        inLanguage: currentLanguage === 'zh' ? 'zh-CN' : 'en',
        copyrightYear: '2011',
        dateModified: SITE_DATE_MODIFIED,
        mainEntity: {
            '@type': 'ItemList',
            name: currentLanguage === 'zh' ? '小玩意工具集合' : 'Gadgets & Tools',
            description: getText(data.description),
            numberOfItems: data.products.length,
            itemListElement
        }
    };

    script.textContent = JSON.stringify(payload);
}

async function loadProducts() {
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        renderPage(data);
        updateMetaTags(currentLanguage);
    } catch (error) {
        console.error('Could not load products:', error);
        document.getElementById('error').style.display = 'block';
    } finally {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'none';
        }
    }
}

function renderPage(data) {
    currentData = data;

    document.getElementById('description').textContent = getText(data.description);

    const currentYear = new Date().getFullYear();
    const footer = document.getElementById('footer-text');
    footer.textContent = '';
    footer.appendChild(document.createTextNode(`© 2011 - ${currentYear} `));

    const authorLink = document.createElement('a');
    authorLink.href = data.profile.website.url;
    authorLink.target = '_blank';
    authorLink.rel = 'noopener noreferrer';
    authorLink.textContent = 'Victor42';
    footer.appendChild(authorLink);
    footer.appendChild(document.createTextNode(' | '));

    const codeLink = document.createElement('a');
    codeLink.href = 'https://github.com/greenzorro/victor42-work';
    codeLink.target = '_blank';
    codeLink.rel = 'noopener noreferrer';
    codeLink.textContent = 'Code';
    footer.appendChild(codeLink);

    renderProfile(data.profile, getText(data.title));

    const productsGrid = document.getElementById('products-grid');
    productsGrid.replaceChildren();

    data.products.forEach((product) => {
        const cardSize = product.image ? 'large' : 'small';
        productsGrid.appendChild(createProductCard(product, cardSize));
    });

    updateStructuredData(data);

    document.getElementById('content').style.display = 'block';
}

function renderProfile(profile, title) {
    const profileSection = document.getElementById('profile-section');
    profileSection.textContent = '';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'profile-avatar';
    const avatar = document.createElement('img');
    avatar.src = profile.avatar;
    avatar.alt = currentLanguage === 'zh' ? 'Victor42头像' : 'Victor42 avatar';
    avatar.loading = 'lazy';
    avatar.setAttribute('itemprop', 'image');
    avatarWrap.appendChild(avatar);

    const nameEl = document.createElement('div');
    nameEl.className = 'profile-name';
    nameEl.setAttribute('itemprop', 'name');
    nameEl.textContent = title;

    const bioEl = document.createElement('div');
    bioEl.className = 'profile-bio';
    bioEl.setAttribute('itemprop', 'description');
    bioEl.textContent = getText(profile.bio);

    const siteLink = document.createElement('a');
    siteLink.href = profile.website.url;
    siteLink.target = '_blank';
    siteLink.rel = 'noopener noreferrer';
    siteLink.className = 'profile-button';
    siteLink.setAttribute('itemprop', 'url');
    siteLink.textContent = `${getText(profile.website.title)} →`;

    profileSection.append(avatarWrap, nameEl, bioEl, siteLink);
}

function createProductCard(product, cardSize) {
    const card = document.createElement('a');
    card.className = `product-card ${cardSize}-card`;
    card.href = product.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.setAttribute('itemscope', '');
    card.setAttribute('itemtype', 'https://schema.org/SoftwareApplication');
    card.setAttribute('itemprop', 'itemListElement');

    const productName = getText(product.name);
    const productDescription = getText(product.description);
    const visitLabel = UI_TEXT[currentLanguage].visit;
    card.setAttribute('aria-label', `${visitLabel} ${productName}: ${productDescription}`);

    if (product.image) {
        const imageWrap = document.createElement('div');
        imageWrap.className = 'product-image';
        const img = document.createElement('img');
        img.src = product.image;
        img.alt = `${productName} - ${productDescription}`;
        img.loading = 'lazy';
        img.setAttribute('itemprop', 'image');
        imageWrap.appendChild(img);
        card.appendChild(imageWrap);
    }

    const content = document.createElement('div');
    content.className = 'product-content';

    const emoji = document.createElement('div');
    emoji.className = 'product-emoji';
    emoji.setAttribute('aria-hidden', 'true');
    emoji.textContent = product.emoji || '';

    const name = document.createElement('h3');
    name.className = 'product-name';
    name.setAttribute('itemprop', 'name');
    name.textContent = productName;

    const desc = document.createElement('p');
    desc.className = 'product-description';
    desc.setAttribute('itemprop', 'description');
    desc.textContent = productDescription;

    const urlMeta = document.createElement('meta');
    urlMeta.setAttribute('itemprop', 'url');
    urlMeta.content = product.url;

    const catMeta = document.createElement('meta');
    catMeta.setAttribute('itemprop', 'applicationCategory');
    catMeta.content = 'WebApplication';

    content.append(emoji, name, desc, urlMeta, catMeta);
    card.appendChild(content);
    return card;
}

function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function syncBackgrounds() {
    if (isDarkTheme()) {
        if (typeof LeafShadowBackground !== 'undefined') LeafShadowBackground.stop();
        if (typeof StarfieldBackground !== 'undefined') StarfieldBackground.start();
    } else {
        if (typeof StarfieldBackground !== 'undefined') StarfieldBackground.stop();
        if (typeof LeafShadowBackground !== 'undefined') LeafShadowBackground.start();
    }
}

function initBackgrounds() {
    if (typeof LeafShadowBackground !== 'undefined') {
        LeafShadowBackground.init('#light-background-canvas');
    }
    if (typeof StarfieldBackground !== 'undefined') {
        StarfieldBackground.init('#background-canvas');
    }
    syncBackgrounds();
}

function bindThemeControls() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem('theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
}

function syncThemeIcon() {
    const themeIcon = document.querySelector('.theme-icon');
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (themeIcon) {
        themeIcon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    }
}

function applyTheme(theme) {
    const html = document.documentElement;

    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }

    syncThemeIcon();
    syncBackgrounds();
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
}
