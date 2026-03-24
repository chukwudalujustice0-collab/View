const VIEW_CONFIG = {
  pages: {
    login: "login.html",
    signup: "signup.html",
    dashboard: "dashboard.html"
  }
};

const SUPABASE_URL = "https://ezarjrxzkqqsbyirxttg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6YXJqcnh6a3Fxc2J5aXJ4dHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzAzODcsImV4cCI6MjA4OTg0NjM4N30.ERyM_zVPU5jUx9ROrbLnY-jYsHzCD8O0lzAeuzEr0oI";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);