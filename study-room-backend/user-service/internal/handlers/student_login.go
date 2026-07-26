package handlers

import (
	"strings"
)

// translitMap — упрощённая транслитерация кириллицы в латиницу для генерации
// человекочитаемого логина ученика (у него нет реальной почты, см. CreateStudent).
var translitMap = map[rune]string{
	'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "e",
	'ж': "zh", 'з': "z", 'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m",
	'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u",
	'ф': "f", 'х': "h", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "sch", 'ъ': "",
	'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",
}

// transliterate приводит строку к латинице в нижнем регистре, оставляя
// только буквы/цифры (пробелы, дефисы и апострофы отбрасываются).
func transliterate(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if lat, ok := translitMap[r]; ok {
			b.WriteString(lat)
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// generateStudentLogin строит человекочитаемый логин вида "ivanov.andrey"
// на основе фамилии и имени. suffix (может быть пустым) добавляется через
// точку для разрешения коллизий (см. CreateStudent).
func generateStudentLogin(lastName, firstName, suffix string) string {
	last := transliterate(lastName)
	first := transliterate(firstName)
	local := strings.Trim(last+"."+first, ".")
	if local == "" {
		local = "student"
	}
	if suffix != "" {
		local += "." + suffix
	}
	return local + "@studyroom.internal"
}
