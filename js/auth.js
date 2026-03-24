const ViewAuth = {
  async requireGuest() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      console.error("Session error:", error.message);
      return true;
    }

    if (data.session?.user) {
      window.location.href = VIEW_CONFIG.pages.dashboard;
      return false;
    }

    return true;
  },

  async signup({ fullName, username, email, phone, accountType, password }) {
    const cleanUsername = String(username || "").trim().toLowerCase();

    const { data, error } = await supabaseClient.auth.signUp({
      email: String(email || "").trim(),
      password,
      options: {
        data: {
          full_name: String(fullName || "").trim(),
          username: cleanUsername,
          account_type: String(accountType || "personal").trim()
        }
      }
    });

    if (error) throw error;

    if (data.user?.id && phone) {
      const { error: phoneError } = await supabaseClient
        .from("profiles")
        .update({ phone: String(phone).trim() })
        .eq("id", data.user.id);

      if (phoneError) {
        console.error("Phone update error:", phoneError.message);
      }
    }

    return data;
  },

  async usernameExists(username) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      console.error("Username lookup error:", error.message);
      return false;
    }

    return !!data;
  }
};