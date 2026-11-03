NLI_FONT_DEFAULTS = {'he': 'default', 'en': 'hadassah'}
NLI_FONT_CHOICES = {
    'he': frozenset(('default', 'guttman', 'hadassah', 'narkiss', 'arial')),
    'en': frozenset(('hadassah', 'narkiss', 'arial', 'belleza', 'marcellus')),
}


def validate_nli_font_choices(value, path='nliFonts'):
    errors = {}
    if not isinstance(value, dict):
        return {f'{path}.he': 'Choose a supported Hebrew font.', f'{path}.en': 'Choose a supported English font.'}
    for language in ('he', 'en'):
        choice = value.get(language)
        if not isinstance(choice, str) or choice not in NLI_FONT_CHOICES[language]:
            errors[f'{path}.{language}'] = f"Choose a supported {'Hebrew' if language == 'he' else 'English'} font."
    for language in value:
        if language not in ('he', 'en'):
            errors[f'{path}.{language}'] = 'unknown field'
    return errors
