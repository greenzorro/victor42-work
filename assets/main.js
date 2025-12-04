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

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 优化的初始化顺序
    updateThemeIcon(); // 更新图标状态
    loadProducts(); // 优先加载主要内容
    initializeBackgroundVideo(); // 初始化静态背景视频
});

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
    // 设置页面描述
    document.getElementById('description').textContent = data.description;
    
    // 设置动态年份
    const currentYear = new Date().getFullYear();
    document.getElementById('footer-text').innerHTML = `© 2011 - ${currentYear} <a href="${data.profile.website.url}" target="_blank" rel="noopener noreferrer">Victor42</a> | <a href="https://github.com/greenzorro/victor42-work" target="_blank" rel="noopener noreferrer">Code</a>`;
    
    // 渲染个人信息，传入title用于显示
    renderProfile(data.profile, data.title);
    
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
        <div class="profile-bio" itemprop="description">${profile.bio}</div>
        <a href="${profile.website.url}" target="_blank" rel="noopener noreferrer" class="profile-button" itemprop="url">
            ${profile.website.title} →
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
    
    // 添加aria-label提升可访问性
    card.setAttribute('aria-label', `访问${product.name}：${product.description}`);
    
    card.innerHTML = `
        ${product.image ? `<div class="product-image">
            <img src="${product.image}" alt="${product.name}产品截图 - ${product.description}" loading="lazy" itemprop="image">
        </div>` : ''}
        <div class="product-content">
            <div class="product-emoji" aria-hidden="true">${product.emoji}</div>
            <h3 class="product-name" itemprop="name">${product.name}</h3>
            <p class="product-description" itemprop="description">${product.description}</p>
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
