import { createApp } from "vue";
import { createPinia } from "pinia";
import GardenMain from "./components/garden/GardenMain.vue";
import "./styles/global.css";

const app = createApp(GardenMain);
app.use(createPinia());
app.mount("#app");
