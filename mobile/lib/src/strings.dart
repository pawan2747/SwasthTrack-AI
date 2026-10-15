import 'logic/health_rules.dart';

/// Which language(s) the app shows.
enum AppLanguage {
  /// Hindi and English together (the default).
  both,
  en,
  hi;

  static AppLanguage parse(String? value) {
    switch (value) {
      case 'en':
        return AppLanguage.en;
      case 'hi':
        return AppLanguage.hi;
      default:
        return AppLanguage.both;
    }
  }
}

/// One piece of text in both languages.
class Bi {
  const Bi(this.hi, this.en);

  final String hi;
  final String en;

  /// Single-line text for the chosen language ("हिंदी · English" for both).
  String of(AppLanguage lang) {
    switch (lang) {
      case AppLanguage.en:
        return en;
      case AppLanguage.hi:
        return hi;
      case AppLanguage.both:
        return (hi == en || en.isEmpty) ? hi : (hi.isEmpty ? en : '$hi · $en');
    }
  }
}

/// All fixed texts of the app, Hindi first. (No intl package: a plain map of
/// named constants is enough for two languages.)
abstract final class S {
  // --- general
  static const appName = Bi('SwasthTrack', 'SwasthTrack');
  static const tagline = Bi(
    'परिवार की सेहत, एक ही जगह',
    'Family health, in one place',
  );
  static const retry = Bi('दोबारा कोशिश करें', 'Try again');
  static const cancel = Bi('रद्द करें', 'Cancel');
  static const save = Bi('सेव करें', 'Save');
  static const delete = Bi('हटाएँ', 'Delete');
  static const edit = Bi('बदलें', 'Edit');
  static const add = Bi('जोड़ें', 'Add');
  static const close = Bi('बंद करें', 'Close');
  static const ok = Bi('ठीक है', 'OK');
  static const yes = Bi('हाँ', 'Yes');
  static const no = Bi('नहीं', 'No');
  static const next = Bi('आगे', 'Next');
  static const back = Bi('पीछे', 'Back');
  static const search = Bi('खोजें', 'Search');
  static const loading = Bi('लोड हो रहा है…', 'Loading…');
  static const optional = Bi('वैकल्पिक', 'Optional');
  static const required = Bi('ज़रूरी', 'Required');
  static const today = Bi('आज', 'Today');
  static const yesterday = Bi('कल', 'Yesterday');
  static const notLogged = Bi('दर्ज नहीं', 'Not logged');
  static const seeAll = Bi('सब देखें', 'See all');
  static const saved = Bi('सेव हो गया', 'Saved');
  static const deleted = Bi('हटा दिया गया', 'Deleted');
  static const confirmDelete = Bi('क्या इसे हटाना है?', 'Delete this entry?');
  static const confirmDeleteBody = Bi(
    'यह वापस नहीं हो सकता।',
    'This cannot be undone.',
  );
  static const viewOnly = Bi(
    'आपके पास सिर्फ़ देखने का एक्सेस है, इसलिए यहाँ कुछ जोड़ा या बदला नहीं जा सकता।',
    'You have view-only access, so entries cannot be added or changed here.',
  );
  static const viewOnlyShort = Bi('सिर्फ़ देखने का एक्सेस', 'View-only access');
  static const noEntries = Bi('अभी कोई एंट्री नहीं है', 'No entries yet');
  static const pullToRefresh = Bi(
    'ताज़ा करने के लिए नीचे खींचें',
    'Pull down to refresh',
  );
  static const dateLabel = Bi('तारीख़', 'Date');
  static const timeLabel = Bi('समय', 'Time');
  static const notesLabel = Bi('नोट', 'Notes');
  static const pickDate = Bi('तारीख़ चुनें', 'Pick date');
  static const pickTime = Bi('समय चुनें', 'Pick time');
  static const kcal = Bi('कैलोरी', 'kcal');
  static const hoursUnit = Bi('घंटे', 'hours');
  static const stepsUnit = Bi('कदम', 'steps');
  static const bpUnit = Bi('mmHg', 'mmHg');
  static const pulseUnit = Bi('धड़कन/मिनट', 'bpm');
  static const kgUnit = Bi('किग्रा', 'kg');

  // --- navigation
  static const navHome = Bi('होम', 'Home');
  static const navHealth = Bi('सेहत', 'Health');
  static const navMedicines = Bi('दवाइयाँ', 'Medicines');
  static const navFood = Bi('खाना', 'Food');
  static const navMore = Bi('और', 'More');

  // --- errors
  static const errNetwork = Bi(
    'इंटरनेट कनेक्शन जाँचें और फिर कोशिश करें।',
    'Check your internet connection and try again.',
  );
  static const errTimeout = Bi(
    'सर्वर से जवाब आने में बहुत देर लगी। फिर कोशिश करें।',
    'The server took too long to answer. Please try again.',
  );
  static const errUnauthorized = Bi(
    'आपका लॉगिन समाप्त हो गया है। कृपया फिर साइन इन करें।',
    'Your sign-in has expired. Please sign in again.',
  );
  static const errNotConfigured = Bi(
    'इस सर्वर पर डेटाबेस अभी चालू नहीं है। सर्वर का पता जाँचें।',
    'This server has no database set up yet. Check the server address.',
  );
  static const errRateLimited = Bi(
    'बहुत ज़्यादा कोशिशें हो गईं। कुछ मिनट रुककर फिर कोशिश करें।',
    'Too many attempts. Please wait a few minutes.',
  );
  static const errServer = Bi(
    'सर्वर पर कुछ गड़बड़ हुई। थोड़ी देर बाद फिर कोशिश करें।',
    'Something went wrong on the server. Please try again shortly.',
  );
  static const errUnknown = Bi(
    'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।',
    'Something went wrong. Please try again.',
  );
  static const errNoCookie = Bi(
    'साइन इन हुआ, पर सर्वर ने सेशन नहीं भेजा। सर्वर का पता जाँचें।',
    'Signed in, but the server sent no session. Check the server address.',
  );
  static const errInvalidCredentials = Bi(
    'ई-मेल या पासवर्ड गलत है।',
    'Incorrect e-mail or password.',
  );
  static const errEmailNotConfirmed = Bi(
    'आपका ई-मेल अभी सत्यापित नहीं है। हमने एक कोड भेजा है, उसे दर्ज करें।',
    'Your e-mail is not verified yet: enter the code we sent you.',
  );
  static const errWeakPassword = Bi(
    'पासवर्ड कम से कम 8 अक्षरों का होना चाहिए।',
    'The password must be at least 8 characters.',
  );
  static const errUserExists = Bi(
    'इस ई-मेल से खाता पहले से है। साइन इन करें, या पासवर्ड रीसेट करें।',
    'An account with this e-mail already exists. Sign in or reset your password.',
  );
  static const errInvalidCode = Bi(
    'कोड गलत है या समाप्त हो चुका है। नया कोड मँगाएँ।',
    'The code is wrong or has expired. Request a new one.',
  );
  static const errInvalidInput = Bi(
    'कृपया जानकारी जाँचें।',
    'Please check the details you entered.',
  );
  static const errSamePassword = Bi(
    'नया पासवर्ड पुराने से अलग रखें।',
    'Choose a password different from the old one.',
  );
  static const errNotSignedIn = Bi(
    'कृपया पहले साइन इन करें।',
    'Please sign in first.',
  );
  static const errEmailFailed = Bi(
    'कोड वाला ई-मेल भेजा नहीं जा सका। थोड़ी देर बाद फिर कोशिश करें।',
    'We could not send the e-mail. Please try again shortly.',
  );
  static const errPermission = Bi(
    'यह बदलाव करने की अनुमति नहीं है, या रिकॉर्ड नहीं मिला।',
    'You are not allowed to do this, or the record was not found.',
  );
  static const errOutOfRange = Bi(
    'दर्ज की गई कीमत मान्य सीमा से बाहर है।',
    'The value is outside the allowed range.',
  );
  static const errAlreadyExists = Bi(
    'यह रिकॉर्ड पहले से मौजूद है।',
    'This record already exists.',
  );
  static const errLinkedMissing = Bi(
    'जुड़ा हुआ रिकॉर्ड नहीं मिला।',
    'A linked record is missing.',
  );
  static const errInviteInvalid = Bi(
    'यह कोड गलत है या पहले इस्तेमाल हो चुका है।',
    'This code is wrong or has already been used.',
  );
  static const errInviteExpired = Bi(
    'यह कोड समाप्त हो चुका है। मालिक से नया कोड माँगें।',
    'This code has expired. Ask the owner for a new one.',
  );
  static const errOwnerOnly = Bi(
    'यह काम सिर्फ़ मरीज़ का मालिक (owner) कर सकता है।',
    'Only the patient owner can do this.',
  );
  static const errTooManyAttempts = Bi(
    'बहुत ज़्यादा कोशिशें। 15 मिनट बाद फिर कोशिश करें।',
    'Too many attempts. Try again in 15 minutes.',
  );
  static const errMigration = Bi(
    'सर्वर का डेटाबेस अपडेट अधूरा है। सर्वर के मालिक से संपर्क करें।',
    'The server database is not fully updated. Contact the server owner.',
  );

  // --- field problems
  static const fpRequired = Bi('यह भरना ज़रूरी है', 'This field is required');
  static const fpNotNumber = Bi('सही संख्या लिखें', 'Enter a valid number');
  static const fpNotWhole = Bi('पूरी संख्या लिखें', 'Enter a whole number');
  static const fpSystolic = Bi(
    'ऊपर का अंक ${Limits.systolicMin} से ${Limits.systolicMax} के बीच होना चाहिए',
    'Top number must be between ${Limits.systolicMin} and ${Limits.systolicMax}',
  );
  static const fpDiastolic = Bi(
    'नीचे का अंक ${Limits.diastolicMin} से ${Limits.diastolicMax} के बीच होना चाहिए',
    'Bottom number must be between ${Limits.diastolicMin} and ${Limits.diastolicMax}',
  );
  static const fpPulse = Bi(
    'नब्ज़ ${Limits.pulseMin} से ${Limits.pulseMax} के बीच लिखें, या खाली छोड़ें',
    'Pulse must be between ${Limits.pulseMin} and ${Limits.pulseMax}, or leave it empty',
  );
  static const fpSysBelowDia = Bi(
    'ऊपर का अंक नीचे के अंक से बड़ा होना चाहिए',
    'The top number must be larger than the bottom number',
  );
  static const fpWeight = Bi(
    'वज़न 20 से 350 किग्रा के बीच होना चाहिए',
    'Weight must be between 20 and 350 kg',
  );
  static const fpSteps = Bi(
    'कदम 0 से 1,00,000 के बीच होने चाहिए',
    'Steps must be between 0 and 100,000',
  );
  static const fpDistance = Bi(
    'दूरी 0 से 100 किमी के बीच होनी चाहिए',
    'Distance must be between 0 and 100 km',
  );
  static const fpMinutes = Bi(
    'समय 0 से 1440 मिनट के बीच होना चाहिए',
    'Minutes must be between 0 and 1440',
  );
  static const fpHours = Bi(
    'घंटे 0 से ज़्यादा और 24 तक होने चाहिए',
    'Hours must be more than 0 and at most 24',
  );
  static const fpQuantity = Bi(
    'मात्रा 0 से ज़्यादा और 20 तक होनी चाहिए',
    'Quantity must be more than 0 and at most 20',
  );
  static const fpGrams = Bi(
    'ग्राम 0 से ज़्यादा और 5000 तक होने चाहिए',
    'Grams must be more than 0 and at most 5000',
  );
  static const fpDateInvalid = Bi('सही तारीख़ चुनें', 'Choose a valid date');
  static const fpDateFuture = Bi(
    'आने वाली तारीख़ दर्ज नहीं हो सकती',
    'A future date cannot be saved',
  );
  static const fpEmail = Bi(
    'सही ई-मेल पता लिखें',
    'Enter a valid e-mail address',
  );
  static const fpCode = Bi('6 अंकों का कोड लिखें', 'Enter the 6-digit code');
  static const fpPassword = Bi(
    'पासवर्ड कम से कम 8 अक्षरों का रखें',
    'Use at least 8 characters',
  );
  static const fpName = Bi('नाम लिखें', 'Enter a name');
  static const fpInviteCode = Bi(
    '8 अक्षरों का पूरा कोड लिखें',
    'Enter the full 8-character code',
  );
  static const fpUrl = Bi(
    'http:// या https:// से शुरू होने वाला सही पता लिखें',
    'Enter a full address starting with http:// or https://',
  );
  static const fpAge = Bi(
    'उम्र 1 से 120 के बीच होनी चाहिए',
    'Age must be between 1 and 120',
  );
  static const fpPositive = Bi(
    '0 से बड़ी संख्या लिखें',
    'Enter a number above 0',
  );

  static Bi forProblem(FieldProblem p) {
    switch (p) {
      case FieldProblem.required:
        return fpRequired;
      case FieldProblem.notANumber:
        return fpNotNumber;
      case FieldProblem.notWhole:
        return fpNotWhole;
      case FieldProblem.systolicRange:
        return fpSystolic;
      case FieldProblem.diastolicRange:
        return fpDiastolic;
      case FieldProblem.pulseRange:
        return fpPulse;
      case FieldProblem.systolicBelowDiastolic:
        return fpSysBelowDia;
      case FieldProblem.weightRange:
        return fpWeight;
      case FieldProblem.stepsRange:
        return fpSteps;
      case FieldProblem.distanceRange:
        return fpDistance;
      case FieldProblem.minutesRange:
        return fpMinutes;
      case FieldProblem.hoursRange:
        return fpHours;
      case FieldProblem.quantityRange:
        return fpQuantity;
      case FieldProblem.gramsRange:
        return fpGrams;
      case FieldProblem.dateInvalid:
        return fpDateInvalid;
      case FieldProblem.dateFuture:
        return fpDateFuture;
    }
  }

  // --- sign in
  static const signIn = Bi('साइन इन', 'Sign in');
  static const signOut = Bi('साइन आउट', 'Sign out');
  static const createAccount = Bi('नया खाता बनाएँ', 'Create account');
  static const haveAccount = Bi(
    'खाता पहले से है? साइन इन करें',
    'Have an account? Sign in',
  );
  static const noAccount = Bi(
    'खाता नहीं है? नया बनाएँ',
    'New here? Create an account',
  );
  static const email = Bi('ई-मेल', 'E-mail');
  static const password = Bi('पासवर्ड', 'Password');
  static const yourName = Bi('आपका नाम', 'Your name');
  static const tabPassword = Bi('पासवर्ड से', 'With password');
  static const tabCode = Bi('ई-मेल कोड से', 'With e-mail code');
  static const sendCode = Bi('कोड भेजें', 'Send code');
  static const codeLabel = Bi('6 अंकों का कोड', '6-digit code');
  static const verify = Bi('जाँचें और आगे बढ़ें', 'Verify and continue');
  static const resendCode = Bi('कोड दोबारा भेजें', 'Send the code again');
  static const codeResent = Bi(
    'नया कोड भेज दिया गया है',
    'A new code has been sent',
  );
  static const forgotPassword = Bi('पासवर्ड भूल गए?', 'Forgot password?');
  static const resetPassword = Bi('पासवर्ड रीसेट करें', 'Reset password');
  static const newPassword = Bi('नया पासवर्ड', 'New password');
  static const setNewPassword = Bi('नया पासवर्ड सेट करें', 'Set new password');
  static const showPassword = Bi('पासवर्ड दिखाएँ', 'Show password');
  static const hidePassword = Bi('पासवर्ड छिपाएँ', 'Hide password');
  static const enterCodeTitle = Bi('कोड दर्ज करें', 'Enter the code');
  static const codeValid10 = Bi(
    'कोड 10 मिनट तक चलता है।',
    'The code works for 10 minutes.',
  );
  static Bi codeSentTo(String email) => Bi(
    'हमने 6 अंकों का कोड $email पर भेजा है।',
    'We sent a 6-digit code to $email.',
  );
  static const serverAddress = Bi('सर्वर का पता', 'Server address');
  static const serverAddressHint = Bi(
    'सिर्फ़ तब बदलें जब आपको अपना सर्वर इस्तेमाल करना हो।',
    'Change this only if you run your own server.',
  );
  static const saveAddress = Bi('पता सेव करें', 'Save address');
  static const resetAddress = Bi('मूल पता लगाएँ', 'Use the default address');
  static const addressSaved = Bi(
    'सर्वर का पता सेव हो गया',
    'Server address saved',
  );
  static const notConfiguredTitle = Bi(
    'सर्वर तैयार नहीं है',
    'Server is not ready',
  );
  static const bootFailedTitle = Bi(
    'सर्वर से जुड़ नहीं पाए',
    'Could not reach the server',
  );

  // --- onboarding
  static const welcomeTitle = Bi('शुरू करें', 'Let’s get started');
  static const welcomeBody = Bi(
    'किसी की सेहत देखने के लिए पहले उनकी प्रोफ़ाइल बनाएँ, या परिवार के किसी सदस्य का दिया कोड दर्ज करें।',
    'Create a profile for the person whose health you track, or enter a code a family member gave you.',
  );
  static const createProfile = Bi('प्रोफ़ाइल बनाएँ', 'Create a profile');
  static const joinWithCode = Bi('कोड से जुड़ें', 'Join with a code');
  static const patientName = Bi('मरीज़ का नाम', 'Patient name');
  static const age = Bi('उम्र', 'Age');
  static const gender = Bi('लिंग', 'Gender');
  static const male = Bi('पुरुष', 'Male');
  static const female = Bi('महिला', 'Female');
  static const other = Bi('अन्य', 'Other');
  static const heightCm = Bi('ऊँचाई (सेमी)', 'Height (cm)');
  static const currentWeight = Bi(
    'अभी का वज़न (किग्रा)',
    'Current weight (kg)',
  );
  static const targetWeight = Bi('लक्ष्य वज़न (किग्रा)', 'Target weight (kg)');
  static const calorieTarget = Bi(
    'रोज़ की कैलोरी का लक्ष्य',
    'Daily calorie target',
  );
  static const inviteCode = Bi('परिवार का कोड', 'Family code');
  static const inviteCodeHint = Bi(
    'मालिक के फ़ोन के ऐप में दिखने वाला 8 अक्षरों का कोड',
    'The 8-character code shown in the owner’s app',
  );
  static const joined = Bi('आप जुड़ गए हैं', 'You have joined');
  static const createProfileFirstNote = Bi(
    'बाद में आप और लोगों को भी जोड़ सकते हैं।',
    'You can add more family members later.',
  );

  // --- home
  static const homeTitle = Bi('आज की सेहत', 'Today’s health');
  static const switchPatient = Bi('मरीज़ बदलें', 'Switch patient');
  static const statusCritical = Bi(
    'ध्यान दें: ज़रूरी चेतावनी',
    'Needs attention now',
  );
  static const statusAttention = Bi(
    'कुछ बातों पर ध्यान दें',
    'A few things need attention',
  );
  static const statusInfo = Bi('जानकारी', 'For your information');
  static const statusOk = Bi('सब ठीक चल रहा है', 'All is well');
  static const allClear = Bi('अभी कोई चेतावनी नहीं है', 'No alerts right now');
  static const viewAlerts = Bi('सभी चेतावनियाँ देखें', 'View all alerts');
  static const alertsTitle = Bi('चेतावनियाँ', 'Alerts');
  static const todaysMedicines = Bi('आज की दवाइयाँ', 'Today’s medicines');
  static const noMedicinesToday = Bi(
    'आज के लिए कोई दवाई नहीं',
    'No medicines for today',
  );
  static const addMedicineFirst = Bi(
    'दवाई जोड़ने के लिए “दवाइयाँ” खोलें।',
    'Open “Medicines” to add one.',
  );
  static const latestBp = Bi('ताज़ा BP', 'Latest BP');
  static const latestWeight = Bi('ताज़ा वज़न', 'Latest weight');
  static const stepsToday = Bi('आज के कदम', 'Steps today');
  static const sleepToday = Bi('नींद', 'Sleep');
  static const caloriesToday = Bi('आज की कैलोरी', 'Calories today');
  static const ofGoal = Bi('लक्ष्य', 'goal');
  static const ofTarget = Bi('लक्ष्य', 'target');
  static const dosesTaken = Bi('ली गईं', 'taken');
  static const alertsUnavailable = Bi(
    'चेतावनियाँ अभी नहीं मिल पाईं',
    'Could not load alerts',
  );
  static const logNow = Bi('अभी दर्ज करें', 'Log now');
  static const todaysSummary = Bi('आज का सार', 'Today’s summary');
  static const readingFrom = Bi('माप', 'Reading');

  // --- health
  static const healthTitle = Bi('सेहत का रिकॉर्ड', 'Health records');
  static const tabBp = Bi('BP', 'BP');
  static const tabWeight = Bi('वज़न', 'Weight');
  static const tabSteps = Bi('कदम', 'Steps');
  static const tabSleep = Bi('नींद', 'Sleep');
  static const addBp = Bi('BP दर्ज करें', 'Add BP reading');
  static const editBp = Bi('BP बदलें', 'Edit BP reading');
  static const addWeight = Bi('वज़न दर्ज करें', 'Add weight');
  static const editWeight = Bi('वज़न बदलें', 'Edit weight');
  static const addSteps = Bi('कदम दर्ज करें', 'Add steps');
  static const editSteps = Bi('कदम बदलें', 'Edit steps');
  static const addSleep = Bi('नींद दर्ज करें', 'Add sleep');
  static const editSleep = Bi('नींद बदलें', 'Edit sleep');
  static const systolic = Bi('ऊपर का अंक (सिस्टोलिक)', 'Top number (systolic)');
  static const diastolic = Bi(
    'नीचे का अंक (डायस्टोलिक)',
    'Bottom number (diastolic)',
  );
  static const pulse = Bi(
    'नब्ज़ (धड़कन प्रति मिनट)',
    'Pulse (beats per minute)',
  );
  static const readingType = Bi('कब नापा', 'When measured');
  static const morning = Bi('सुबह', 'Morning');
  static const evening = Bi('शाम', 'Evening');
  static const special = Bi('खास', 'Special');
  static const weightKg = Bi('वज़न (किग्रा)', 'Weight (kg)');
  static const stepsCount = Bi('कदमों की संख्या', 'Number of steps');
  static const walkingMinutes = Bi(
    'चलने का समय (मिनट)',
    'Walking time (minutes)',
  );
  static const distanceKm = Bi('दूरी (किमी)', 'Distance (km)');
  static const sleepHours = Bi('नींद के घंटे', 'Hours slept');
  static const trend = Bi('रुझान', 'Trend');
  static const recent = Bi('हाल की एंट्री', 'Recent entries');
  static const notEnoughForChart = Bi(
    'ग्राफ़ के लिए कम से कम 2 एंट्री चाहिए',
    'At least 2 entries are needed for a chart',
  );
  static const confirmUnusualTitle = Bi('क्या यह सही है?', 'Is this correct?');
  static const confirmUnusualBody = Bi(
    'यह माप आम माप से काफ़ी अलग है। एक बार फिर देख लें।',
    'This reading is quite different from usual. Please check it once more.',
  );
  static const yesCorrect = Bi('हाँ, सही है', 'Yes, it is correct');
  static const checkAgain = Bi('दोबारा जाँचता हूँ', 'Let me check again');
  static const caloriesBurnedNote = Bi(
    'जला हुआ कैलोरी का अनुमान कदमों और वज़न से लगाया जाता है।',
    'Calories burned are estimated from steps and weight.',
  );
  static const bpCrisisNote = Bi(
    'यह रीडिंग बहुत ऊँची है। 5 मिनट आराम से बैठकर दोबारा नापें। अगर रीडिंग अब भी इतनी ही है, या सीने में दर्द, साँस फूलना, कमज़ोरी, बोलने में दिक्कत या तेज़ सिरदर्द हो, तो तुरंत इमरजेंसी (112) बुलाएँ और डॉक्टर से संपर्क करें।',
    'This reading is very high. Rest for 5 minutes and measure again. If it is still this high, or there is chest pain, breathlessness, weakness, trouble speaking or a severe headache, call emergency services (112) and contact a doctor.',
  );
  static const bpLowNote = Bi(
    'यह रीडिंग कम है। चक्कर या कमज़ोरी लगे तो लेट जाएँ और डॉक्टर से बात करें। अपनी दवा खुद से बंद न करें।',
    'This reading is low. If you feel dizzy or weak, lie down and talk to a doctor. Do not stop medicines on your own.',
  );
  static const goalLine = Bi('लक्ष्य', 'Goal');
  static const lastNDays = Bi('पिछली एंट्री', 'Latest entries');

  // --- medicines
  static const medicinesTitle = Bi('दवाइयाँ', 'Medicines');
  static const schedule = Bi('आज का समय-सारणी', 'Today’s schedule');
  static const adherence7 = Bi('पिछले 7 दिन', 'Last 7 days');
  static const adherenceNone = Bi(
    'अभी हिसाब के लिए कोई खुराक नहीं',
    'No doses to measure yet',
  );
  static const markTaken = Bi('ली — दर्ज करें', 'Mark as taken');
  static const markMissed = Bi('छूटी — दर्ज करें', 'Mark as missed');
  static const undo = Bi('वापस करें', 'Undo');
  static const stateTaken = Bi('ली गई', 'Taken');
  static const stateLate = Bi('देर से ली', 'Taken late');
  static const stateMissed = Bi('छूट गई', 'Missed');
  static const statePending = Bi('अभी बाकी', 'Due now');
  static const stateUpcoming = Bi('आगे आने वाली', 'Later today');
  static const stateAutoMissed = Bi(
    'छूट गई (दर्ज नहीं हुई)',
    'Missed (not logged)',
  );
  static const lateIfNow = Bi(
    'अभी लेने पर “देर से” दर्ज होगी',
    'If taken now it is logged as late',
  );
  static const addMedicine = Bi('दवाई जोड़ें', 'Add medicine');
  static const medicineName = Bi('दवाई का नाम', 'Medicine name');
  static const dose = Bi(
    'खुराक (जैसे 40 mg, 1 गोली)',
    'Dose (e.g. 40 mg, 1 tablet)',
  );
  static const scheduledTime = Bi('दवाई का समय', 'Time of day');
  static const mealRelation = Bi('खाने के साथ', 'With food');
  static const noRelation = Bi('बताया नहीं', 'Not specified');
  static const afterMeal = Bi('खाने के बाद', 'After food');
  static const beforeMeal = Bi('खाने से पहले', 'Before food');
  static const withMeal = Bi('खाने के साथ', 'With food');
  static const emptyStomach = Bi('खाली पेट', 'Empty stomach');
  static const frequency = Bi('कितनी बार', 'How often');
  static const freqDaily = Bi('रोज़ाना 1 बार', 'Once daily');
  static const freqTwice = Bi('दिन में 2 बार', 'Twice daily');
  static const freqThrice = Bi('दिन में 3 बार', 'Thrice daily');
  static const freqAsNeeded = Bi('ज़रूरत पड़ने पर', 'As needed');
  static const stopMedicine = Bi('दवाई बंद करें', 'Stop this medicine');
  static const stopMedicineBody = Bi(
    'इसका पुराना रिकॉर्ड बना रहेगा। यह आगे की सूची में नहीं दिखेगी।',
    'Past records are kept. It will no longer appear in the schedule.',
  );
  static const restartMedicine = Bi('फिर से शुरू करें', 'Start again');
  static const stoppedMedicines = Bi('बंद की हुई दवाइयाँ', 'Stopped medicines');
  static const allMedicines = Bi('सभी दवाइयाँ', 'All medicines');
  static const medicineOnlyOnce = Bi(
    'ध्यान दें: हर दवाई के लिए एक दिन में एक ही बार दर्ज होता है।',
    'Note: one record is kept per medicine per day.',
  );
  static const fpMedName = Bi('दवाई का नाम लिखें', 'Enter the medicine name');
  static const fpMedDose = Bi('खुराक लिखें', 'Enter the dose');
  static const fpMedTime = Bi('समय चुनें', 'Choose a time');
  static const lateNote = Bi(
    'देर से लेने की वजह से “देर से” दर्ज हुई',
    'Recorded as late because it was past its time',
  );

  // --- food
  static const foodTitle = Bi('खाना', 'Food');
  static const addFood = Bi('खाना जोड़ें', 'Add food');
  static const searchFood = Bi(
    'खाना खोजें (जैसे रोटी, दाल)',
    'Search food (e.g. roti, dal)',
  );
  static const searchHint = Bi(
    'कम से कम 2 अक्षर लिखें',
    'Type at least 2 letters',
  );
  static const noFoodFound = Bi(
    'कुछ नहीं मिला। दूसरा नाम आज़माएँ।',
    'Nothing found. Try another name.',
  );
  static const didYouMean = Bi('शायद आपका मतलब', 'Showing results for');
  static const mealLabel = Bi('कौन सा भोजन', 'Which meal');
  static const portion = Bi('मात्रा की इकाई', 'Portion');
  static const howMany = Bi('कितनी', 'How many');
  static const byGrams = Bi('ग्राम में लिखें', 'Enter grams instead');
  static const byPortion = Bi('इकाई से चुनें', 'Choose a portion instead');
  static const gramsLabel = Bi('ग्राम / मि.ली.', 'Grams / ml');
  static const oilLabel = Bi('तेल / घी की मात्रा', 'Oil or ghee used');
  static const oilNone = Bi('बिना तेल', 'No oil');
  static const oilHalfTsp = Bi('½ चम्मच', '½ tsp');
  static const oilTsp = Bi('1 चम्मच', '1 tsp');
  static const oil2Tsp = Bi('2 चम्मच', '2 tsp');
  static const oilTbsp = Bi('1 बड़ा चम्मच', '1 tbsp');
  static const oilUnknown = Bi('पता नहीं', 'Not sure');
  static const estimate = Bi('अनुमान', 'Estimate');
  static const protein = Bi('प्रोटीन', 'Protein');
  static const carbs = Bi('कार्ब्स', 'Carbs');
  static const fat = Bi('वसा', 'Fat');
  static const fibre = Bi('फ़ाइबर', 'Fibre');
  static const saveMeal = Bi('खाना सेव करें', 'Save food');
  static const total = Bi('कुल', 'Total');
  static const targetShort = Bi('लक्ष्य', 'Target');
  static const noMealsToday = Bi(
    'इस दिन कोई खाना दर्ज नहीं है',
    'No food logged for this day',
  );
  static const previousDay = Bi('पिछला दिन', 'Previous day');
  static const nextDay = Bi('अगला दिन', 'Next day');
  static const confidenceLabel = Bi('अनुमान कितना पक्का', 'How certain');
  static const mealBreakfast = Bi('नाश्ता', 'Breakfast');
  static const mealMidMorning = Bi('बीच का नाश्ता', 'Mid-morning');
  static const mealLunch = Bi('दोपहर का खाना', 'Lunch');
  static const mealEveningSnack = Bi('शाम का नाश्ता', 'Evening snack');
  static const mealDinner = Bi('रात का खाना', 'Dinner');
  static const mealBedtime = Bi('सोने से पहले', 'Bedtime');
  static const mealOther = Bi('अन्य', 'Other');

  static Bi forMeal(String id) {
    switch (id) {
      case 'Breakfast':
        return mealBreakfast;
      case 'Mid-morning':
        return mealMidMorning;
      case 'Lunch':
        return mealLunch;
      case 'Evening snack':
        return mealEveningSnack;
      case 'Dinner':
        return mealDinner;
      case 'Bedtime':
        return mealBedtime;
      default:
        return mealOther;
    }
  }

  static Bi forOil(String id) {
    switch (id) {
      case '1/2 tsp':
        return oilHalfTsp;
      case '1 tsp':
        return oilTsp;
      case '2 tsp':
        return oil2Tsp;
      case '1 tbsp':
        return oilTbsp;
      case 'Unknown':
        return oilUnknown;
      default:
        return oilNone;
    }
  }

  // --- more
  static const moreTitle = Bi('और', 'More');
  static const profile = Bi('मेरी प्रोफ़ाइल', 'My profile');
  static const displayName = Bi('नाम', 'Name');
  static const nameSaved = Bi('नाम सेव हो गया', 'Name saved');
  static const settings = Bi('सेटिंग', 'Settings');
  static const language = Bi('भाषा', 'Language');
  static const langBoth = Bi(
    'हिंदी + English दोनों',
    'Hindi + English together',
  );
  static const langEn = Bi('सिर्फ़ English', 'English only');
  static const langHi = Bi('सिर्फ़ हिंदी', 'Hindi only');
  static const careTeam = Bi('परिवार / देखभाल करने वाले', 'Care team');
  static const careTeamBody = Bi(
    'जिन्हें इस मरीज़ की सेहत देखने या दर्ज करने का एक्सेस है।',
    'People who can see or log this patient’s health.',
  );
  static const roleOwner = Bi('मालिक', 'Owner');
  static const roleEditor = Bi('दर्ज कर सकते हैं', 'Can log entries');
  static const roleViewer = Bi('सिर्फ़ देख सकते हैं', 'View only');
  static const inviteTitle = Bi(
    'परिवार के सदस्य को जोड़ें',
    'Invite a family member',
  );
  static const inviteRole = Bi('उन्हें क्या करने दें', 'What they may do');
  static const createInvite = Bi('कोड बनाएँ', 'Create a code');
  static const inviteCodeIs = Bi('यह कोड उन्हें दें', 'Give them this code');
  static const inviteValid15 = Bi(
    'कोड 15 मिनट तक चलता है और एक बार इस्तेमाल होता है।',
    'The code works for 15 minutes and can be used once.',
  );
  static const revoke = Bi('एक्सेस हटाएँ', 'Remove access');
  static const revokeBody = Bi(
    'यह व्यक्ति अब इस मरीज़ का डेटा नहीं देख पाएगा।',
    'This person will no longer see this patient’s data.',
  );
  static const revoked = Bi('हटाया गया', 'Removed');
  static const you = Bi('आप', 'You');
  static const aboutTitle = Bi('ऐप के बारे में', 'About');
  static const version = Bi('संस्करण', 'Version');
  static const disclaimerTitle = Bi('ज़रूरी सूचना', 'Important notice');
  static const disclaimer = Bi(
    'यह ऐप बीमारी की पहचान (डायग्नोसिस) नहीं करता। स्वास्थ्य से जुड़े फ़ैसलों के लिए डॉक्टर से सलाह लें।',
    'This app does not diagnose. Consult a doctor for medical decisions.',
  );
  static const emergency = Bi(
    'आपातकाल में 112 पर कॉल करें।',
    'In an emergency, call 112.',
  );
  static const patientsSection = Bi('मरीज़', 'Patients');
  static const addAnotherPatient = Bi(
    'एक और मरीज़ जोड़ें',
    'Add another patient',
  );
  static const joinAnother = Bi(
    'दूसरे कोड से जुड़ें',
    'Join with another code',
  );
  static const signOutConfirm = Bi('क्या साइन आउट करना है?', 'Sign out?');
  static const signOutBody = Bi(
    'इस फ़ोन से आपका लॉगिन हट जाएगा।',
    'Your sign-in will be removed from this phone.',
  );
  static const noMembers = Bi('अभी कोई और सदस्य नहीं', 'No other members yet');
  static const ownerOnlyCareTeam = Bi(
    'देखभाल करने वालों की सूची सिर्फ़ मालिक देख सकता है।',
    'Only the owner can see and manage the care team.',
  );
  static const accountSection = Bi('खाता', 'Account');
  static const dataSection = Bi('डेटा', 'Data');
  static const copyCode = Bi('कोड कॉपी करें', 'Copy code');
  static const copied = Bi('कॉपी हो गया', 'Copied');
}
