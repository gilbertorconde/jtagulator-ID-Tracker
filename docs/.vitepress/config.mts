import { defineConfig } from "vitepress";

const repo = "https://github.com/gilbertorconde/pinhound";
const site = "https://gilbertorconde.github.io/pinhound/";

export default defineConfig({
  title: "PinHound",
  description: "PinHound: enhanced firmware and tools for the JTAGulator. Manual for the firmware, PinHound Studio and the command-line tool",
  base: "/pinhound/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["**/_*.md", "README.md"],
  head: [["link", { rel: "icon", href: "/pinhound/favicon.png" }]],
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
        text: "PinHound Studio",
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
      {
        text: "Project",
        items: [
          { text: "Building and contributing", link: "/development" },
          { text: "Credits", link: "/credits" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/master/docs/:path`, text: "Edit this page on GitHub" },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: {
      message: "PinHound is MIT licensed and independent of Grand Idea Studio. The original JTAGulator firmware is CC BY 3.0 US.",
      copyright: "JTAGulator by Joe Grand, Grand Idea Studio · Manufacturer ID database by Weiao (Chaoschaos1024)",
    },
  },
});
