/**
 * Victor42 创造营地 - 小玩意工具集合
 * 主要功能脚本
 */

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    loadProducts();
});

// 加载产品数据
async function loadProducts() {
    try {
        const response = await fetch('./data/products.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        renderPage(data);
    } catch (error) {
        console.error('Failed to load products:', error);
        showError();
    }
}

// 渲染页面
function renderPage(data) {
    // 设置页面标题和描述
    document.getElementById('page-title').textContent = data.title;
    document.getElementById('description').textContent = data.description;
    
    // 设置动态年份
    const currentYear = new Date().getFullYear();
    document.getElementById('footer-text').innerHTML = `© 2011 - ${currentYear} <a href="${data.profile.website.url}" target="_blank" rel="noopener noreferrer">Victor42</a>`;
    
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
            <img src="${profile.avatar}" alt="${title}" loading="lazy">
        </div>
        <div class="profile-name">${title}</div>
        <div class="profile-bio">${profile.bio}</div>
        <a href="${profile.website.url}" target="_blank" rel="noopener noreferrer" class="profile-button">
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
    
    card.innerHTML = `
        ${product.image ? `<div class="product-image">
            <img src="${product.image}" alt="${product.name}" loading="lazy">
        </div>` : ''}
        <div class="product-content">
            <div class="product-emoji">${product.emoji}</div>
            <h3 class="product-name">${product.name}</h3>
            <p class="product-description">${product.description}</p>
        </div>
    `;
    
    return card;
}

// 显示错误信息
function showError() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
}

// 等页面加载完成后初始化（备用方案）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        loadProducts();
    });
} else {
    loadProducts();
} 