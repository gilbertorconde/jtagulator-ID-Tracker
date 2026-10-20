import { defineConfig } from "vitepress";

const repo = "https://github.com/gilbertorconde/jtagulator-ID-Tracker";
const site = "https://gilbertorconde.github.io/jtagulator-ID-Tracker/";

export default defineConfig({
  title: "JTAGulator ID Tracker",
  description: "Manual for the JTAGulator, the ID Tracker firmware and JTAGulator Studio",
  base: "/jtagulator-ID-Tracker/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["**/_*.md", "README.md"],
  head: [["link", { rel: "icon", href: "/jtagulator-ID-Tracker/favicon.png" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Studio", link: "/studio/" },
      { text: "Open the web app", link: `${site}app/`, target: "_self" },
      { text: "Downloads", link: `${repo}/releases` },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Introduction", link: "/guide/introduction" },
          { text: "Firmware", link: "/guide/firmware" },
          { text: "Connecting the device", link: "/guide/connecting" },
          { text: "Safety", link: "/guide/safety" },
        ],
      },
      {
        text: "Using the firmware",
        items: [
          { text: "Commands overview", link: "/guide/commands" },
          { text: "GPIO", link: "/guide/gpio" },
          { text: "JTAG", link: "/guide/jtag" },
          { text: "UART", link: "/guide/uart" },
          { text: "SWD", link: "/guide/swd" },
          { text: "Manufacturer database", link: "/guide/database" },
          { text: "Troubleshooting", link: "/guide/troubleshooting" },
        ],
      },
      {
        text: "JTAGulator Studio",
        items: [
          { text: "Overview", link: "/studio/" },
          { text: "Web version", link: "/studio/web" },
          { text: "Logic analyzer", link: "/studio/logic-analyzer" },
          { text: "OpenOCD and GDB", link: "/studio/openocd" },
          { text: "Targets and chip IDs", link: "/studio/targets" },
          { text: "Scripting", link: "/studio/scripting" },
          { text: "Command-line tool", link: "/studio/cli" },
        ],
      },
      { text: "Development", items: [{ text: "Building and contributing", link: "/development" }] },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/master/docs/:path`, text: "Edit this page on GitHub" },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: { message: "MIT licensed. The original JTAGulator firmware is CC BY 3.0 US.", copyright: "JTAGulator by Joe Grand, Grand Idea Studio" },
  },
});
