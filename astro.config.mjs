import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { readFileSync } from 'node:fs';
const courses = JSON.parse(readFileSync(new URL('./src/data/projects.json', import.meta.url), 'utf8'));

const base = process.env.SITE_BASE || '/mojing-fiction-platform';
function publicAssetBase() {
  return tree => {
    const walk = node => {
      if ((node.type === 'image' || node.type === 'link') && /^\/(diagrams|reports)\//.test(node.url || '')) node.url = base.replace(/\/$/, '') + node.url;
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
  };
}
export default defineConfig({
  site: process.env.SITE_URL || 'https://AiW520.github.io',
  base,
  output: 'static',
  trailingSlash: 'always',
  markdown: { remarkPlugins: [publicAssetBase] },
  integrations: [starlight({
    title: "teat1 / 墨境",
    description: '从真实源码出发，读懂架构、追踪流程、动手验证。',
    defaultLocale: 'root',
    locales: { root: { label: '简体中文', lang: 'zh-CN' } },
    customCss: ['./src/styles/theme.css'],
    components: { Footer: './src/components/Footer.astro', PageTitle: './src/components/PageTitle.astro' },
    sidebar: [
      { label: '开始学习', items: [
        {label: '学习地图', link: '/'},
        {label: '项目目录与筛选', link: '/projects/'},
        {label: '术语与技术索引', link: '/glossary/'},
        {label: '源码版本与差异', link: '/source-version/'},
        {label: '分析范围与验证', link: '/coverage/'},
        {label: '证据索引', link: '/evidence-index/'},
        {label: '来源与许可证', link: '/sources/'},
      ] },
      ...courses.map(c => ({ label: c.title, autogenerate: { directory: `courses/${c.id}` }, collapsed: true })),
      { label: '源码证据', autogenerate: { directory: 'evidence' }, collapsed: true },
      { label: '使用与部署', link: '/deployment/' }
    ],
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    pagination: true,
    expressiveCode: { themes: ['github-light', 'github-dark'] },
  })],
});
