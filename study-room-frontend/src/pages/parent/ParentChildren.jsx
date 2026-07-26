import PeopleDirectory from "../shared/PeopleDirectory.jsx";

// Родитель: список своих детей + добавление нового ребёнка (см. PeopleDirectory).
export default function ParentChildren() {
  return <PeopleDirectory role="parent" />;
}
