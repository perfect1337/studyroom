import PeopleDirectory from "../shared/PeopleDirectory.jsx";

// Репетитор (tutor): видит только тех учеников, которые реально записаны
// к нему (фильтр по его enrollments — см. PeopleDirectory).
export default function TutorStudents() {
  return <PeopleDirectory role="tutor" />;
}
