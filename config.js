// Settings you can change without rebuilding the app.
// The anon/publishable key is meant to be public. Never put the service_role (secret) key here.
window.PN_CONFIG = {
  appName: 'Passing Notes',
  supabaseUrl: 'https://lkuzjmwgwnnwenkhfmbm.supabase.co',
  supabaseAnonKey: 'sb_publishable_Q1JZZLILE0QBM_Dr7lp_sw_EalJXYi4',
  // Tag notifications are paused. Change to true to show the opt-in again.
  notifications: false,
  // Paste the PUBLIC key of your web push key pair here (the private one goes only into Supabase secrets).
  vapidPublicKey: 'BAk6SuZrNqGn_SfHH7VZSQz_ImHv-DpyzHV-YV-uGh22TnuIjiyRVTsaTndbQpNbJj9EdiSMHzZ1FFasIl8RQFU',
};
