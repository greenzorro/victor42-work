/*
 * File: main.js
 * Project: assets
 * Created: 2025-07-16 08:05:41
 * Author: Victor Cheng
 * Email: hi@victor42.work
 * Description: 
 */

/**
 * Victor42 创造营地 - 小玩意工具集合
 * 主要功能脚本
 */

// 全局变量存储当前数据
let currentData = null;
let currentLanguage = 'zh';

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 优化的初始化顺序
    initializeLanguage(); // 初始化语言设置
    updateThemeIcon(); // 更新图标状态
    loadProducts(); // 优先加载主要内容
    initializeBackgroundVideo(); // 初始化静态背景视频
});

/**
 * 语言管理相关函数
 */

// 初始化语言设置
function initializeLanguage() {
    // 1. 检查URL参数
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');

    // 2. 检查localStorage
    const savedLang = localStorage.getItem('language');

    // 3. 确定当前语言（优先级：URL参数 > localStorage > 默认中文）
    if (urlLang && (urlLang === 'zh' || urlLang === 'en')) {
        currentLanguage = urlLang;
    } else if (savedLang && (savedLang === 'zh' || savedLang === 'en')) {
        currentLanguage = savedLang;
    } else {
        currentLanguage = 'zh'; // 默认中文
    }

    // 保存到localStorage
    localStorage.setItem('language', currentLanguage);

    // 更新语言按钮显示
    updateLanguageButton();

    // 更新HTML lang属性
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';

    // 添加语言切换事件监听器
    const langToggle = document.getElementById('lang-toggle');
    if (langToggle) {
        langToggle.addEventListener('click', toggleLanguage);
    }
}

// 获取当前语言
function getCurrentLanguage() {
    return currentLanguage;
}

// 切换语言
function toggleLanguage() {
    const newLanguage = currentLanguage === 'zh' ? 'en' : 'zh';
    setLanguage(newLanguage);
}

// 设置语言
function setLanguage(lang) {
    if (lang !== 'zh' && lang !== 'en') return;

    currentLanguage = lang;
    localStorage.setItem('language', lang);

    // 更新URL参数（不刷新页面）
    const url = new URL(window.location);
    url.searchParams.set('lang', lang);
    window.history.replaceState({}, '', url);

    // 更新HTML lang属性
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    // 更新语言按钮显示
    updateLanguageButton();

    // 如果数据已加载，重新渲染页面
    if (currentData) {
        renderPage(currentData);
    }

    // 更新meta标签
    updateMetaTags(lang);
}

// 更新语言按钮显示
function updateLanguageButton() {
    const langText = document.querySelector('.lang-text');
    if (langText) {
        // 显示当前语言的切换选项（如果当前是中文，显示"EN"，反之亦然）
        langText.textContent = currentLanguage === 'zh' ? 'EN' : '中文';
    }
}

// 获取翻译文本
function getText(textObj) {
    // 如果是字符串，直接返回
    if (typeof textObj === 'string') {
        return textObj;
    }
    // 如果是对象且有zh/en属性，返回对应语言的文本
    if (typeof textObj === 'object' && textObj !== null) {
        if (currentLanguage in textObj) {
            return textObj[currentLanguage];
        }
        if ('zh' in textObj) {
            return textObj['zh'];
        }
        // 返回对象的第一个值
        const values = Object.values(textObj);
        if (values.length > 0) {
            return values[0];
        }
    }
    return '';
}

// 更新meta标签
function updateMetaTags(lang) {
    // 更新HTML lang属性
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');

    // 更新页面标题
    const titleElement = document.getElementById('page-title');
    if (titleElement && currentData) {
        const title = getText(currentData.title);
        const suffix = lang === 'zh' ? '的创造营地 - 小玩意工具集合' : "'s Creations - Gadgets & Tools";
        titleElement.textContent = `${title}${suffix}`;

        // 更新document.title
        document.title = `${title}${suffix}`;
    }

    // 更新meta description（如果数据中有提供）
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription && currentData) {
        const description = getText(currentData.description);
        metaDescription.setAttribute('content', description);
    }

    // 更新Open Graph标签
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogLocale = document.querySelector('meta[property="og:locale"]');

    if (ogTitle && currentData) {
        const title = getText(currentData.title);
        const suffix = lang === 'zh' ? '的创造营地 - 小玩意工具集合' : "'s Creations - Gadgets & Tools";
        ogTitle.setAttribute('content', `${title}${suffix}`);
    }

    if (ogDescription && currentData) {
        const description = getText(currentData.description);
        ogDescription.setAttribute('content', description);
    }

    if (ogLocale) {
        ogLocale.setAttribute('content', lang === 'zh' ? 'zh_CN' : 'en_US');
    }

    // 更新Twitter Card标签
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    const twitterDescription = document.querySelector('meta[name="twitter:description"]');

    if (twitterTitle && currentData) {
        const title = getText(currentData.title);
        const suffix = lang === 'zh' ? '的创造营地 - 小玩意工具集合' : "'s Creations - Gadgets & Tools";
        twitterTitle.setAttribute('content', `${title}${suffix}`);
    }

    if (twitterDescription && currentData) {
        const description = getText(currentData.description);
        twitterDescription.setAttribute('content', description);
    }
}

// 加载产品数据
// 异步加载所有产品
async function loadProducts() {
    try {
        const response = await fetch('./data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        renderPage(data);
    } catch (error) {
        console.error('Could not load products:', error);
        // 显示错误信息
        document.getElementById('error').style.display = 'block';
    } finally {
        // 隐藏加载动画
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'none';
        }
    }
}

// 渲染页面
function renderPage(data) {
    // 保存数据到全局变量
    currentData = data;

    // 设置页面描述 - 使用多语言支持
    document.getElementById('description').textContent = getText(data.description);

    // 设置动态年份
    const currentYear = new Date().getFullYear();
    const codeLink = '<a href="https://github.com/greenzorro/victor42-work" target="_blank" rel="noopener noreferrer">Code</a>';
    document.getElementById('footer-text').innerHTML = `© 2011 - ${currentYear} <a href="${data.profile.website.url}" target="_blank" rel="noopener noreferrer">Victor42</a> | ${codeLink}`;

    // 渲染个人信息，传入title用于显示
    renderProfile(data.profile, getText(data.title));

    // 按原始顺序保持产品排列
    const products = data.products;

    const productsGrid = document.getElementById('products-grid');
    productsGrid.innerHTML = '';

    products.forEach((product) => {
        // 根据是否有图片决定卡片大小
        const cardSize = product.image ? 'large' : 'small';
        const card = createProductCard(product, cardSize);
        productsGrid.appendChild(card);
    });

    // 隐藏加载动画，显示内容
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
}

// 渲染个人信息
function renderProfile(profile, title) {
    const profileSection = document.getElementById('profile-section');

    profileSection.innerHTML = `
        <div class="profile-avatar">
            <img src="${profile.avatar}" alt="Victor42头像照片" loading="lazy" itemprop="image">
        </div>
        <div class="profile-name" itemprop="name">${title}</div>
        <div class="profile-bio" itemprop="description">${getText(profile.bio)}</div>
        <a href="${profile.website.url}" target="_blank" rel="noopener noreferrer" class="profile-button" itemprop="url">
            ${getText(profile.website.title)} →
        </a>
    `;
}

// 创建产品卡片
function createProductCard(product, cardSize) {
    const card = document.createElement('a');
    card.className = `product-card ${cardSize}-card`;
    card.href = product.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.setAttribute('itemscope', '');
    card.setAttribute('itemtype', 'https://schema.org/SoftwareApplication');
    card.setAttribute('itemprop', 'itemListElement');

    // 获取多语言文本
    const productName = getText(product.name);
    const productDescription = getText(product.description);

    // 添加aria-label提升可访问性
    card.setAttribute('aria-label', `访问${productName}：${productDescription}`);

    card.innerHTML = `
        ${product.image ? `<div class="product-image">
            <img src="${product.image}" alt="${productName}产品截图 - ${productDescription}" loading="lazy" itemprop="image">
        </div>` : ''}
        <div class="product-content">
            <div class="product-emoji" aria-hidden="true">${product.emoji}</div>
            <h3 class="product-name" itemprop="name">${productName}</h3>
            <p class="product-description" itemprop="description">${productDescription}</p>
            <meta itemprop="url" content="${product.url}">
            <meta itemprop="applicationCategory" content="WebApplication">
        </div>
    `;

    return card;
}



// 更新主题图标状态（主题已在head中设置）
function updateThemeIcon() {
    const html = document.documentElement;
    const themeIcon = document.querySelector('.theme-icon');
    const currentTheme = html.getAttribute('data-theme');
    
    if (themeIcon) {
        themeIcon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    }
    
    // 添加切换按钮事件监听器
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem('theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
}

function applyTheme(theme) {
    const html = document.documentElement;
    const themeIcon = document.querySelector('.theme-icon');
    const backgroundVideo = document.querySelector('.background-video');
    
    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
        if (themeIcon) themeIcon.textContent = '☀️';
        
        // 播放背景视频
        if (backgroundVideo) {
            backgroundVideo.play().catch(error => {
                console.log('背景视频播放失败:', error);
            });
        }
    } else {
        html.removeAttribute('data-theme');
        if (themeIcon) themeIcon.textContent = '🌙';
        
        // 暂停背景视频
        if (backgroundVideo) {
            backgroundVideo.pause();
        }
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    // 应用新主题
    applyTheme(newTheme);
    
    // 保存用户偏好
    localStorage.setItem('theme', newTheme);
}

// 初始化背景视频（静态元素）
function initializeBackgroundVideo() {
    const backgroundVideo = document.querySelector('.background-video');
    const html = document.documentElement;
    const isDarkMode = html.getAttribute('data-theme') === 'dark';
    
    if (backgroundVideo) {
        // 触发浏览器自动选择最佳视频格式
        backgroundVideo.load();
        
        // 优化的事件监听
        backgroundVideo.addEventListener('error', function() {
            console.log('背景视频加载失败，使用纯色背景');
            backgroundVideo.style.display = 'none';
        });
        
        backgroundVideo.addEventListener('loadeddata', function() {
            console.log('背景视频加载成功');
        });
        
        // 根据当前主题决定是否播放
        if (isDarkMode) {
            backgroundVideo.play().catch(error => {
                console.log('背景视频播放失败:', error);
            });
        }
    }
}
